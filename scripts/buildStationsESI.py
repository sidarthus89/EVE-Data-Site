#!/usr/bin/env python3
"""
EVE Online NPC Station Scraper using ESI API
Pulls all NPC stations and compiles them into a comprehensive list
"""

import requests
import json
import time
from typing import List, Dict, Optional
import csv
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading


class EVEStationScraper:
    def __init__(self):
        self.base_url = "https://esi.evetech.net/latest"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'EVE-Station-Scraper/1.0'
        })
        self.lock = threading.Lock()

    def get_all_systems(self) -> List[int]:
        """Get all system IDs from ESI"""
        print("Fetching all system IDs...")
        url = f"{self.base_url}/universe/systems/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            system_ids = response.json()
            print(f"Found {len(system_ids)} systems")
            return system_ids
        except requests.RequestException as e:
            print(f"Error fetching system IDs: {e}")
            return []

    def get_system_stations(self, system_id: int) -> List[int]:
        """Get station IDs from a specific system"""
        url = f"{self.base_url}/universe/systems/{system_id}/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            system_data = response.json()
            return system_data.get('stations', [])
        except requests.RequestException as e:
            # Don't print individual system errors as it clutters output
            return []

    def get_all_stations(self) -> List[int]:
        """Get all NPC station IDs by searching through systems"""
        system_ids = self.get_all_systems()
        if not system_ids:
            return []

        print("Searching systems for NPC stations...")
        all_stations = []
        processed = 0

        # Use threading to speed up the process
        with ThreadPoolExecutor(max_workers=10) as executor:
            # Submit all system requests
            future_to_system = {
                executor.submit(self.get_system_stations, system_id): system_id
                for system_id in system_ids
            }

            for future in as_completed(future_to_system):
                system_id = future_to_system[future]
                try:
                    stations = future.result()
                    if stations:
                        with self.lock:
                            all_stations.extend(stations)

                    processed += 1
                    if processed % 500 == 0:
                        print(
                            f"Processed {processed}/{len(system_ids)} systems, found {len(all_stations)} stations so far...")

                except Exception as e:
                    pass  # Skip failed systems

        print(
            f"Found {len(all_stations)} total NPC stations across {len(system_ids)} systems")
        return list(set(all_stations))  # Remove duplicates

    def get_station_info(self, station_id: int) -> Optional[Dict]:
        """Get detailed information for a specific station"""
        url = f"{self.base_url}/universe/stations/{station_id}/"

        try:
            response = self.session.get(url)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            return None

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

    def compile_station_list(self, station_ids: List[int] = None) -> List[Dict]:
        """Compile comprehensive list of NPC stations with details"""
        if station_ids is None:
            station_ids = self.get_all_stations()

        if not station_ids:
            print("No station IDs to process")
            return []

        stations = []
        systems_cache = {}
        constellations_cache = {}
        regions_cache = {}

        total = len(station_ids)
        print(f"\nGetting detailed information for {total} stations...")

        for i, station_id in enumerate(station_ids, 1):
            if i % 100 == 0:
                print(f"Processing station {i}/{total} (ID: {station_id})")

            # Get station info
            station_info = self.get_station_info(station_id)
            if not station_info:
                continue

            # Get system info (with caching)
            system_id = station_info.get('system_id')
            if system_id and system_id not in systems_cache:
                systems_cache[system_id] = self.get_system_info(system_id)
            system_info = systems_cache.get(system_id)

            # Get constellation and region info through the hierarchy
            region_id = None
            region_name = None

            if system_info:
                constellation_id = system_info.get('constellation_id')
                if constellation_id:
                    # Get constellation info (with caching)
                    if constellation_id not in constellations_cache:
                        constellations_cache[constellation_id] = self.get_constellation_info(
                            constellation_id)
                    constellation_info = constellations_cache.get(
                        constellation_id)

                    if constellation_info:
                        region_id = constellation_info.get('region_id')
                        if region_id:
                            # Get region info (with caching)
                            if region_id not in regions_cache:
                                regions_cache[region_id] = self.get_region_info(
                                    region_id)
                            region_info = regions_cache.get(region_id)

                            if region_info:
                                region_name = region_info.get(
                                    'name', 'Unknown')

            # Compile station data with only requested fields
            station_data = {
                'station_id': station_id,
                'name': station_info.get('name', 'Unknown'),
                'system_id': system_id,
                'system_name': system_info.get('name', 'Unknown') if system_info else 'Unknown',
                'region_id': region_id,
                'region_name': region_name or 'Unknown',
                'security_status': system_info.get('security_status') if system_info else None,
                'services': station_info.get('services', [])
            }

            stations.append(station_data)

            # Small delay to be respectful to ESI
            time.sleep(0.01)

        return stations

    def save_to_json(self, stations: List[Dict], filename: str = 'stations.json'):
        """Save stations to JSON file"""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(stations, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(stations)} stations to {filename}")

    def save_to_csv(self, stations: List[Dict], filename: str = 'stations.csv'):
        """Save stations to CSV file"""
        if not stations:
            return

        # Create a copy for CSV to avoid modifying original data
        csv_stations = []
        for station in stations:
            csv_station = station.copy()
            csv_station['services'] = ', '.join(
                map(str, station.get('services', [])))
            csv_stations.append(csv_station)

        fieldnames = csv_stations[0].keys()

        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(csv_stations)
        print(f"Saved {len(stations)} stations to {filename}")


def main():
    scraper = EVEStationScraper()

    print("EVE Online NPC Station Scraper")
    print("=" * 50)
    print("This will take 15-20 minutes to complete...")
    print("=" * 50)

    # Get all stations (no limit)
    stations = scraper.compile_station_list()

    if stations:
        print(f"\nSuccessfully compiled {len(stations)} NPC stations")

        # Save to both formats
        scraper.save_to_json(stations)
        scraper.save_to_csv(stations)

        # Print some sample data and statistics
        print("\nStation Statistics:")
        print(f"- Total stations: {len(stations)}")

        # Count by security status
        highsec = sum(1 for s in stations if s.get(
            'security_status', 0) >= 0.5)
        lowsec = sum(1 for s in stations if 0 <
                     s.get('security_status', 0) < 0.5)
        nullsec = sum(1 for s in stations if s.get('security_status', 0) <= 0)

        print(f"- High-sec stations: {highsec}")
        print(f"- Low-sec stations: {lowsec}")
        print(f"- Null-sec stations: {nullsec}")

        print("\nSample stations:")
        for station in stations[:5]:
            sec_status = station.get('security_status', 0)
            sec_class = "High" if sec_status >= 0.5 else "Low" if sec_status > 0 else "Null"
            print(
                f"- {station['name']} in {station['system_name']}, {station['region_name']} ({sec_class}-sec)")

    else:
        print("No stations found or error occurred")


if __name__ == "__main__":
    main()
