#!/usr/bin/env python3
"""
EVE Online Player Structure Market Scraper using ESI API
Pulls all player structures with public markets accessible to all players
Requires ESI authentication
"""

import requests
import json
import time
from typing import List, Dict, Optional, Set
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import webbrowser
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import base64
import hashlib
import secrets
import os


class OAuthHandler(BaseHTTPRequestHandler):
    """Simple HTTP server to handle OAuth callback"""

    def do_GET(self):
        print(f"Received callback: {self.path}")  # Debug line

        if self.path.startswith('/callback'):
            # Extract authorization code from callback
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)

            print(f"Query parameters: {params}")  # Debug line

            if 'code' in params and len(params['code']) > 0:
                self.server.auth_code = params['code'][0]
                # Debug line
                print(
                    f"Authorization code received: {self.server.auth_code[:10]}...")

                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                self.wfile.write(b'''<html><body>
                    <h1>Authorization successful!</h1>
                    <p>Code received successfully. You can close this window.</p>
                    <p>The application will continue automatically.</p>
                </body></html>''')
            else:
                print("No authorization code found in callback")  # Debug line
                self.server.auth_code = None
                self.send_response(400)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                self.wfile.write(
                    b'<html><body><h1>Authorization failed!</h1><p>No code parameter found.</p></body></html>')
        else:
            self.send_response(404)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<html><body><h1>Not Found</h1></body></html>')

    def log_message(self, format, *args):
        # Enable log messages for debugging
        print(f"HTTP: {format % args}")


class EVEStructureScraper:
    def __init__(self, client_id: str, client_secret: str):
        self.base_url = "https://esi.evetech.net/latest"
        self.oauth_url = "https://login.eveonline.com/v2/oauth"
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = "http://localhost:8080/callback"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'EVE-Structure-Scraper/1.0'
        })
        self.access_token = None
        self.lock = threading.Lock()

        # Required scopes for accessing structure information
        self.scopes = [
            'esi-universe.read_structures.v1',
            'esi-markets.structure_markets.v1'
        ]

    def generate_pkce_challenge(self) -> tuple[str, str]:
        """Generate PKCE code verifier and challenge"""
        code_verifier = base64.urlsafe_b64encode(
            secrets.token_bytes(32)).decode('utf-8').rstrip('=')
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode('utf-8')).digest()
        ).decode('utf-8').rstrip('=')
        return code_verifier, code_challenge

    def authenticate(self) -> bool:
        """Handle ESI OAuth authentication"""
        print("Starting ESI authentication...")

        # Generate PKCE parameters
        code_verifier, code_challenge = self.generate_pkce_challenge()
        state = secrets.token_urlsafe(32)

        # Build authorization URL
        auth_params = {
            'response_type': 'code',
            'redirect_uri': self.redirect_uri,
            'client_id': self.client_id,
            'scope': ' '.join(self.scopes),
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
            'state': state
        }

        auth_url = f"{self.oauth_url}/authorize?" + \
            urllib.parse.urlencode(auth_params)

        print(f"Opening browser for authentication...")
        print(f"If browser doesn't open, visit: {auth_url}")
        webbrowser.open(auth_url)

        # Start local server to handle callback
        server = HTTPServer(('localhost', 8080), OAuthHandler)
        server.timeout = 120  # 2 minute timeout
        server.auth_code = None

        print("Waiting for authentication callback...")
        print("Please complete the login in your browser...")

        # Handle multiple requests if needed
        max_attempts = 3
        for attempt in range(max_attempts):
            try:
                server.handle_request()
                print(f"Handled request {attempt + 1}")

                if hasattr(server, 'auth_code') and server.auth_code is not None:
                    print("Authorization code successfully received!")
                    break

            except Exception as e:
                print(f"Error handling request: {e}")

            if attempt < max_attempts - 1:
                print("Waiting for callback... (try refreshing the browser if needed)")

        if not hasattr(server, 'auth_code') or server.auth_code is None:
            print("Authentication failed - no authorization code received")
            print("Please check that:")
            print("1. You completed the login process")
            print(
                "2. The callback URL in your ESI app is: http://localhost:8080/callback")
            print("3. No firewall is blocking port 8080")
            return False

        # Exchange authorization code for access token
        token_data = {
            'grant_type': 'authorization_code',
            'code': server.auth_code,
            'redirect_uri': self.redirect_uri,
            'code_verifier': code_verifier,
            'client_id': self.client_id
        }

        # Use client credentials in the request body instead of basic auth
        token_data['client_secret'] = self.client_secret

        headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'EVE-Structure-Scraper/1.0'
        }

        print("Exchanging authorization code for access token...")

        try:
            response = requests.post(
                f"{self.oauth_url}/token",
                data=token_data,
                headers=headers
            )

            print(f"Token request status: {response.status_code}")

            if response.status_code != 200:
                print(
                    f"Token request failed with status {response.status_code}")
                print(f"Response: {response.text}")
                return False

            response.raise_for_status()

            token_info = response.json()
            self.access_token = token_info['access_token']

            print("Access token received successfully!")

            # Update session headers with access token
            self.session.headers.update({
                'Authorization': f'Bearer {self.access_token}'
            })

            print("Authentication successful!")
            return True

        except requests.RequestException as e:
            print(f"Token exchange failed: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response status: {e.response.status_code}")
                print(f"Response text: {e.response.text}")
            return False

    def get_all_structures(self) -> List[int]:
        """Get all structure IDs from ESI"""
        print("Fetching all structure IDs...")
        url = f"{self.base_url}/universe/structures/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            structure_ids = response.json()
            print(f"Found {len(structure_ids)} structures")
            return structure_ids
        except requests.RequestException as e:
            print(f"Error fetching structure IDs: {e}")
            if response.status_code == 403:
                print(
                    "Access denied - check your ESI application permissions and character access")
            return []

    def get_structure_info(self, structure_id: int) -> Optional[Dict]:
        """Get detailed information for a specific structure"""
        url = f"{self.base_url}/universe/structures/{structure_id}/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            return None

    def has_public_market(self, structure_id: int) -> tuple[bool, str]:
        """Check if a structure has a public market - returns (has_market, reason)"""
        url = f"{self.base_url}/markets/structures/{structure_id}/"

        try:
            response = self.session.get(url)

            if response.status_code == 200:
                # Successfully got market data - definitely has a public market
                market_data = response.json()
                return True, f"Public market confirmed ({len(market_data)} orders)"
            elif response.status_code == 403:
                # Forbidden - might have a market but not public, or no access
                return False, "Access forbidden (private market or no access)"
            elif response.status_code == 404:
                # Not found - no market or structure doesn't exist
                return False, "No market found"
            else:
                # Other error
                return False, f"HTTP {response.status_code}"

        except requests.RequestException as e:
            return False, f"Request error: {e}"

    def check_structure_services(self, structure_info: Dict) -> bool:
        """Check if structure has market-related services"""
        services = structure_info.get('services', [])

        # Debug: print services to see what we're getting
        if services:
            print(f"Structure services found: {services}")

        # Market service IDs in EVE - let's be more inclusive
        market_services = [
            1,     # Market
            8,     # Insurance
            16,    # Market Hub
            # Add more potential market-related services
            32,    # Fitting
            64,    # Clone Bay
        ]

        has_market = any(service in market_services for service in services)

        # Also check if it's a structure type that commonly has markets
        type_id = structure_info.get('type_id')
        market_structure_types = [
            35832,  # Astrahus (Citadel Medium)
            35833,  # Fortizar (Citadel Large)
            35834,  # Keepstar (Citadel XL)
            35825,  # Raitaru (Engineering Complex Medium)
            35826,  # Azbel (Engineering Complex Large)
            35827,  # Sotiyo (Engineering Complex XL)
            35835,  # Athanor (Refinery Medium)
            35836,  # Tatara (Refinery Large)
        ]

        is_market_structure_type = type_id in market_structure_types

        return has_market or is_market_structure_type

    def get_system_info(self, system_id: int) -> Optional[Dict]:
        """Get system information"""
        url = f"{self.base_url}/universe/systems/{system_id}/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            return None

    def get_constellation_info(self, constellation_id: int) -> Optional[Dict]:
        """Get constellation information"""
        url = f"{self.base_url}/universe/constellations/{constellation_id}/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            return None

    def get_region_info(self, region_id: int) -> Optional[Dict]:
        """Get region information"""
        url = f"{self.base_url}/universe/regions/{region_id}/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            return None

    def process_structure_batch(self, structure_ids: List[int]) -> tuple[List[Dict], Dict]:
        """Process a batch of structures and return those with public markets + debug info"""
        structures_with_markets = []
        debug_info = {
            'total_processed': 0,
            'info_retrieved': 0,
            'market_checks': {'public': 0, 'forbidden': 0, 'not_found': 0, 'other': 0},
            'service_checks': {'has_market_service': 0, 'no_market_service': 0}
        }

        systems_cache = {}
        constellations_cache = {}
        regions_cache = {}

        for structure_id in structure_ids:
            debug_info['total_processed'] += 1

            # Get structure info
            structure_info = self.get_structure_info(structure_id)
            if not structure_info:
                continue

            debug_info['info_retrieved'] += 1

            # Check services first (faster than API call)
            has_market_service = self.check_structure_services(structure_info)
            if has_market_service:
                debug_info['service_checks']['has_market_service'] += 1
            else:
                debug_info['service_checks']['no_market_service'] += 1

            # Check if structure has a public market
            has_market, reason = self.has_public_market(structure_id)

            # Categorize the market check result
            if "Public market confirmed" in reason:
                debug_info['market_checks']['public'] += 1
            elif "forbidden" in reason.lower():
                debug_info['market_checks']['forbidden'] += 1
            elif "not found" in reason.lower():
                debug_info['market_checks']['not_found'] += 1
            else:
                debug_info['market_checks']['other'] += 1

            # Include structures that either have confirmed public markets OR have market services
            # This casts a wider net to catch more potential market structures
            if not (has_market or has_market_service):
                continue

            # Get location information
            system_id = structure_info.get('solar_system_id')
            system_info = None
            region_id = None
            region_name = None

            if system_id:
                if system_id not in systems_cache:
                    systems_cache[system_id] = self.get_system_info(system_id)
                system_info = systems_cache.get(system_id)

                if system_info:
                    constellation_id = system_info.get('constellation_id')
                    if constellation_id:
                        if constellation_id not in constellations_cache:
                            constellations_cache[constellation_id] = self.get_constellation_info(
                                constellation_id)
                        constellation_info = constellations_cache.get(
                            constellation_id)

                        if constellation_info:
                            region_id = constellation_info.get('region_id')
                            if region_id:
                                if region_id not in regions_cache:
                                    regions_cache[region_id] = self.get_region_info(
                                        region_id)
                                region_info = regions_cache.get(region_id)

                                if region_info:
                                    region_name = region_info.get(
                                        'name', 'Unknown')

            # Compile structure data in the requested format
            structure_data = {
                # Convert to string to match format
                'stationID': str(structure_id),
                'locationName': structure_info.get('name', 'Unknown'),
                'regionID': region_id,
                'regionName': region_name or 'Unknown',
                'systemID': system_id,
                'systemName': system_info.get('name', 'Unknown') if system_info else 'Unknown',
                'security': system_info.get('security_status') if system_info else None,
                'type': 'player',
                # Keep additional fields for debugging/reference (these won't be in final JSON)
                '_debug_type_id': structure_info.get('type_id'),
                '_debug_owner_id': structure_info.get('owner_id'),
                '_debug_position': structure_info.get('position', {}),
                '_debug_services': structure_info.get('services', []),
                '_debug_market_status': reason,
                '_debug_has_market_service': has_market_service
            }

            structures_with_markets.append(structure_data)

            # Small delay to be respectful to ESI
            time.sleep(0.02)

        return structures_with_markets, debug_info

    def compile_structure_list(self, structure_ids: List[int] = None) -> List[Dict]:
        """Compile comprehensive list of player structures with public markets"""
        if structure_ids is None:
            structure_ids = self.get_all_structures()

        if not structure_ids:
            print("No structure IDs to process")
            return []

        print(
            f"\nChecking {len(structure_ids)} structures for public markets...")
        print("This may take a while as we need to check each structure individually...")

        all_structures = []
        total_debug = {
            'total_processed': 0,
            'info_retrieved': 0,
            'market_checks': {'public': 0, 'forbidden': 0, 'not_found': 0, 'other': 0},
            'service_checks': {'has_market_service': 0, 'no_market_service': 0}
        }

        batch_size = 50  # Process in smaller batches for better progress reporting

        # Split structure IDs into batches
        batches = [structure_ids[i:i + batch_size]
                   for i in range(0, len(structure_ids), batch_size)]

        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_batch = {
                executor.submit(self.process_structure_batch, batch): i
                for i, batch in enumerate(batches)
            }

            completed_batches = 0
            for future in as_completed(future_to_batch):
                batch_num = future_to_batch[future]
                try:
                    structures, debug_info = future.result()

                    # Merge debug info
                    total_debug['total_processed'] += debug_info['total_processed']
                    total_debug['info_retrieved'] += debug_info['info_retrieved']
                    for key in total_debug['market_checks']:
                        total_debug['market_checks'][key] += debug_info['market_checks'][key]
                    for key in total_debug['service_checks']:
                        total_debug['service_checks'][key] += debug_info['service_checks'][key]

                    with self.lock:
                        all_structures.extend(structures)

                    completed_batches += 1
                    structures_processed = completed_batches * batch_size

                    print(
                        f"Processed {min(structures_processed, len(structure_ids))}/{len(structure_ids)} structures")
                    print(
                        f"  - Retrieved info: {total_debug['info_retrieved']}")
                    print(f"  - Market checks: Public:{total_debug['market_checks']['public']} "
                          f"Forbidden:{total_debug['market_checks']['forbidden']} "
                          f"NotFound:{total_debug['market_checks']['not_found']}")
                    print(
                        f"  - Found {len(all_structures)} structures with markets/services")

                except Exception as e:
                    print(f"Error processing batch {batch_num}: {e}")

        # Print final debug summary
        print(f"\n=== FINAL DEBUGGING SUMMARY ===")
        print(f"Total structures processed: {total_debug['total_processed']}")
        print(f"Structure info retrieved: {total_debug['info_retrieved']}")
        print(f"Market check results:")
        for status, count in total_debug['market_checks'].items():
            print(f"  - {status}: {count}")
        print(f"Service check results:")
        for status, count in total_debug['service_checks'].items():
            print(f"  - {status}: {count}")
        print(f"================================")

        print(f"\nPost-processing: Resolving unknown names...")

        # Collect all IDs that need name resolution
        unknown_structure_ids = []
        unknown_system_ids = []
        unknown_region_ids = []

        for structure in all_structures:
            if structure['locationName'] == 'Unknown':
                # Extract structure ID from stationID string
                structure_id = int(structure['stationID'])
                unknown_structure_ids.append(structure_id)

            if structure['systemName'] == 'Unknown' and structure['systemID']:
                unknown_system_ids.append(structure['systemID'])

            if structure['regionName'] == 'Unknown' and structure['regionID']:
                unknown_region_ids.append(structure['regionID'])

        # Batch resolve names
        all_unknown_ids = unknown_structure_ids + \
            unknown_system_ids + unknown_region_ids
        if all_unknown_ids:
            print(f"Resolving {len(all_unknown_ids)} unknown names...")
            resolved_names = self.get_names_from_ids(all_unknown_ids)

            # Update structures with resolved names
            for structure in all_structures:
                structure_id = int(structure['stationID'])

                # Update structure names
                if structure['locationName'] == 'Unknown' and structure_id in resolved_names:
                    structure['locationName'] = resolved_names[structure_id]

                # Update system names
                if structure['systemName'] == 'Unknown' and structure['systemID'] in resolved_names:
                    structure['systemName'] = resolved_names[structure['systemID']]

                # Update region names
                if structure['regionName'] == 'Unknown' and structure['regionID'] in resolved_names:
                    structure['regionName'] = resolved_names[structure['regionID']]

            print(f"Resolved names for {len(resolved_names)} items")

        print(
            f"\nFound {len(all_structures)} structures with markets or market services")
        return all_structures

    def save_to_json(self, structures: List[Dict], filename: str = 'player_structures.json'):
        """Save structures to JSON file in the requested format"""
        # Clean up the data to match the requested format exactly
        cleaned_structures = []
        for structure in structures:
            clean_structure = {
                'stationID': structure['stationID'],
                'locationName': structure['locationName'],
                'regionID': structure['regionID'],
                'regionName': structure['regionName'],
                'systemID': structure['systemID'],
                'systemName': structure['systemName'],
                'security': structure['security'],
                'type': structure['type']
            }
            cleaned_structures.append(clean_structure)

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(cleaned_structures, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(cleaned_structures)} structures to {filename}")

    def save_debug_json(self, structures: List[Dict], filename: str = 'player_structures_debug.json'):
        """Save structures with all debug information to separate JSON file"""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(structures, f, indent=2, ensure_ascii=False)
        print(f"Saved debug information to {filename}")

    def save_to_csv(self, structures: List[Dict], filename: str = 'player_structures.csv'):
        """Save structures to CSV file"""
        if not structures:
            return

        # Create a copy for CSV to avoid modifying original data
        csv_structures = []
        for structure in structures:
            csv_structure = structure.copy()

            # Convert complex fields to strings
            csv_structure['services'] = ', '.join(
                map(str, structure.get('services', [])))

            # Handle position data
            position = structure.get('position', {})
            csv_structure['position_x'] = position.get('x')
            csv_structure['position_y'] = position.get('y')
            csv_structure['position_z'] = position.get('z')
            del csv_structure['position']  # Remove the dict version

            csv_structures.append(csv_structure)

        fieldnames = csv_structures[0].keys()

        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_structures)
        print(f"Saved {len(structures)} structures to {filename}")


def main():
    # ============= CONFIGURATION =============
    # Replace these with your ESI application credentials
    CLIENT_ID = "1a4eabe7a8e5432ea943f6ff695bde1d"
    CLIENT_SECRET = "t0UpKVMGhp8CIVAbCdY3Gd0aoUea8b8wrmewmqHR"

    # Verify credentials are set
    if CLIENT_ID == "your_client_id_here" or CLIENT_SECRET == "your_client_secret_here":
        print("ERROR: Please set your CLIENT_ID and CLIENT_SECRET in the script")
        print("Edit the script and replace 'your_client_id_here' and 'your_client_secret_here'")
        print("with your actual ESI application credentials")
        return
    # ========================================

    print("EVE Online Player Structure Market Scraper")
    print("=" * 50)
    print("Starting automated authentication...")
    print("A browser window will open for ESI login.")
    print("=" * 50)

    client_id = CLIENT_ID
    client_secret = CLIENT_SECRET

    scraper = EVEStructureScraper(client_id, client_secret)

    # Authenticate
    if not scraper.authenticate():
        print("Authentication failed. Exiting.")
        return

    print("\nStarting structure scan...")
    print("This will take a considerable amount of time (30+ minutes) as there are many structures to check...")
    print("=" * 50)

    # Get all structures with public markets
    structures = scraper.compile_structure_list()

    if structures:
        print(
            f"\nSuccessfully found {len(structures)} player structures with public markets")

        # Save to both formats
        scraper.save_to_json(structures)
        scraper.save_debug_json(structures)  # Save debug version too
        scraper.save_to_csv(structures)

        # Print statistics
        print("\nStructure Statistics:")
        print(f"- Total structures with public markets: {len(structures)}")

        # Count by security status
        highsec = sum(1 for s in structures if s.get('security', 0) >= 0.5)
        lowsec = sum(1 for s in structures if 0 < s.get('security', 0) < 0.5)
        nullsec = sum(1 for s in structures if s.get('security', 0) <= 0)

        print(f"- High-sec structures: {highsec}")
        print(f"- Low-sec structures: {lowsec}")
        print(f"- Null-sec structures: {nullsec}")

        # Count by region
        regions = {}
        for structure in structures:
            region = structure.get('regionName', 'Unknown')
            regions[region] = regions.get(region, 0) + 1

        print(f"\nTop regions by structure count:")
        for region, count in sorted(regions.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"- {region}: {count}")

        print("\nSample structures:")
        for structure in structures[:5]:
            sec_status = structure.get('security', 0)
            sec_class = "High" if sec_status >= 0.5 else "Low" if sec_status > 0 else "Null"
            print(
                f"- {structure['locationName']} in {structure['systemName']}, {structure['regionName']} ({sec_class}-sec)")

    else:
        print("No structures with public markets found or error occurred")


if __name__ == "__main__":
    main()
