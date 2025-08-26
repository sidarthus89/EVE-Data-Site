import azure.functions as func
import json
import logging
import os

app = func.FunctionApp()

# Import database helper
try:
    from utils.azure_helpers import DatabaseHelper
    db = DatabaseHelper()
    static_data = {}
    logging.info("Database helper imported successfully")
except ImportError as e:
    logging.error(f"Failed to import database helper: {e}")
    db = None
    static_data = {}


@app.route(route="health", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET"])
def health_check(req: func.HttpRequest) -> func.HttpResponse:
    """Health check endpoint with database connectivity test"""
    try:
        # Test database connection
        if db:
            tables = db.execute_query(
                "SELECT COUNT(*) as table_count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'")
            table_count = tables[0]['table_count'] if tables else 0

            return func.HttpResponse(
                json.dumps({
                    "status": "healthy",
                    "message": "EVE Trade API is running on Azure Functions",
                    "database": "connected",
                    "tables": table_count,
                    "endpoints": ["/hauling", "/station", "/orders", "/resources"]
                }),
                status_code=200,
                mimetype="application/json",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Headers": "Content-Type"
                }
            )
        else:
            return func.HttpResponse(
                json.dumps({
                    "status": "degraded",
                    "message": "EVE Trade API is running but database is unavailable",
                    "database": "disconnected",
                    "endpoints": ["/hauling", "/station", "/orders", "/resources"]
                }),
                status_code=200,
                mimetype="application/json",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Headers": "Content-Type"
                }
            )
    except Exception as e:
        logging.error(f"Health check database error: {str(e)}")
        return func.HttpResponse(
            json.dumps({
                "status": "degraded",
                "message": "EVE Trade API is running but database is unavailable",
                "database": "disconnected",
                "error": str(e),
                "endpoints": ["/hauling", "/station", "/orders"]
            }),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )


@app.route(route="hauling", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET", "POST"])
def hauling_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """Hauling endpoint - database integrated version"""
    try:
        logging.info('Hauling endpoint called')

        # Get query parameters
        from_region = req.params.get(
            'from', '10000002')  # Default to The Forge
        to_region = req.params.get('to', '10000043')      # Default to Domain

        if db:
            # Query database for profitable trades between regions
            query = """
            SELECT TOP 20
                m1.type_id,
                m1.price as buy_price,
                m1.location_id as from_location,
                m2.price as sell_price,
                m2.location_id as to_location,
                (m2.price - m1.price) as profit_per_unit,
                ((m2.price - m1.price) / m1.price * 100) as profit_percentage,
                LEAST(m1.volume_remain, m2.volume_remain) as max_volume
            FROM market_orders m1
            JOIN market_orders m2 ON m1.type_id = m2.type_id
            WHERE m1.is_buy_order = 0 
              AND m2.is_buy_order = 1
              AND m1.region_id = %s
              AND m2.region_id = %s
              AND m2.price > m1.price
              AND m1.volume_remain > 0
              AND m2.volume_remain > 0
            ORDER BY profit_percentage DESC
            """

            trades = db.execute_query(query, (from_region, to_region))

            # Format response
            result = {
                'message': 'Hauling data retrieved from database',
                'from_region': from_region,
                'to_region': to_region,
                'trades': trades,
                'status': 'Connected to Azure SQL Database'
            }
        else:
            # Fallback to mock data if database unavailable
            result = {
                'message': 'Database unavailable, showing mock data',
                'from_region': from_region,
                'to_region': to_region,
                'trades': [
                    {
                        'type_id': 34,
                        'buy_price': 5.50,
                        'sell_price': 6.35,
                        'profit_per_unit': 0.85,
                        'profit_percentage': 15.45
                    }
                ]
            }

        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )
    except Exception as e:
        logging.error(f"Error in hauling endpoint: {str(e)}")
        # Return mock data if database fails
        result = {
            'message': 'Database error, showing mock data',
            'error': str(e),
            'from_region': from_region,
            'to_region': to_region,
            'trades': [
                {
                    'type_id': 34,
                    'buy_price': 5.50,
                    'sell_price': 6.35,
                    'profit_per_unit': 0.85,
                    'profit_percentage': 15.45
                }
            ]
        }
        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )


@app.route(route="station", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET", "POST"])
def station_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """Station endpoint - database integrated version"""
    try:
        logging.info('Station endpoint called')

        station_id = req.params.get('station_id', '60003760')

        if db:
            # Query database for station trading opportunities
            query = """
            SELECT TOP 20
                buy_orders.type_id,
                buy_orders.price as buy_price,
                sell_orders.price as sell_price,
                (sell_orders.price - buy_orders.price) as profit_per_unit,
                ((sell_orders.price - buy_orders.price) / buy_orders.price * 100) as profit_percentage,
                LEAST(buy_orders.volume_remain, sell_orders.volume_remain) as max_volume
            FROM market_orders buy_orders
            JOIN market_orders sell_orders ON buy_orders.type_id = sell_orders.type_id
            WHERE buy_orders.station_id = %s
              AND sell_orders.station_id = %s
              AND buy_orders.is_buy_order = 1
              AND sell_orders.is_buy_order = 0
              AND sell_orders.price > buy_orders.price
              AND buy_orders.volume_remain > 0
              AND sell_orders.volume_remain > 0
            ORDER BY profit_percentage DESC
            """

            trades = db.execute_query(query, (station_id, station_id))

            result = {
                'message': 'Station trading data retrieved from database',
                'station_id': station_id,
                'trades': trades,
                'status': 'Connected to Azure SQL Database'
            }
        else:
            # Fallback to mock data
            result = {
                'message': 'Database unavailable, showing mock data',
                'station_id': station_id,
                'trades': [
                    {
                        'type_id': 34,
                        'buy_price': 5.50,
                        'sell_price': 6.35,
                        'profit_per_unit': 0.85,
                        'profit_percentage': 15.45
                    }
                ]
            }

        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )
    except Exception as e:
        logging.error(f"Error in station endpoint: {str(e)}")
        # Return mock data if database fails
        result = {
            'message': 'Database error, showing mock data',
            'error': str(e),
            'station_id': station_id,
            'trades': [
                {
                    'type_id': 34,
                    'buy_price': 5.50,
                    'sell_price': 6.35,
                    'profit_per_unit': 0.85,
                    'profit_percentage': 15.45
                }
            ]
        }
        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )


@app.route(route="orders", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET", "POST"])
def orders_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """Orders endpoint - database integrated version"""
    try:
        logging.info('Orders endpoint called')

        region_id = req.params.get('region_id', '10000002')
        type_id = req.params.get('type_id')

        if db:
            # Build query based on parameters
            if type_id:
                query = """
                SELECT TOP 50
                    order_id,
                    type_id,
                    location_id,
                    station_id,
                    is_buy_order,
                    price,
                    volume_remain,
                    issued
                FROM market_orders
                WHERE region_id = %s AND type_id = %s
                ORDER BY price DESC, volume_remain DESC
                """
                params = (region_id, type_id)
            else:
                query = """
                SELECT TOP 50
                    order_id,
                    type_id,
                    location_id,
                    station_id,
                    is_buy_order,
                    price,
                    volume_remain,
                    issued
                FROM market_orders
                WHERE region_id = %s
                ORDER BY price DESC, volume_remain DESC
                """
                params = (region_id,)

            orders = db.execute_query(query, params)

            result = {
                'message': 'Market orders retrieved from database',
                'region_id': region_id,
                'type_id': type_id,
                'orders': orders,
                'status': 'Connected to Azure SQL Database'
            }
        else:
            # Fallback to mock data
            result = {
                'message': 'Database unavailable, showing mock data',
                'region_id': region_id,
                'type_id': type_id,
                'orders': [
                    {
                        'order_id': 12345,
                        'type_id': 34,
                        'station_id': 60003760,
                        'is_buy_order': False,
                        'price': 6.35,
                        'volume_remain': 1000
                    }
                ]
            }

        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )
    except Exception as e:
        logging.error(f"Error in orders endpoint: {str(e)}")
        # Return mock data if database fails
        result = {
            'message': 'Database error, showing mock data',
            'error': str(e),
            'region_id': region_id,
            'type_id': type_id,
            'orders': [
                {
                    'order_id': 12345,
                    'type_id': 34,
                    'station_id': 60003760,
                    'is_buy_order': False,
                    'price': 6.35,
                    'volume_remain': 1000
                }
            ]
        }
        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )


@app.route(route="resources/{resource_name}", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET"])
def resources_endpoint(req: func.HttpRequest) -> func.HttpResponse:
    """Resources endpoint - serve static EVE data files"""
    try:
        resource_name = req.route_params.get('resource_name')
        logging.info(f'Resources endpoint called for: {resource_name}')

        # Try to load from actual files first
        try:
            import os
            # Look for resources in the project root directory
            current_dir = os.path.dirname(__file__)
            resources_path = os.path.join(
                current_dir, 'resources', resource_name)

            if os.path.exists(resources_path):
                with open(resources_path, 'r', encoding='utf-8') as f:
                    resource_data = json.load(f)

                logging.info(
                    f'Successfully loaded {resource_name} with {len(str(resource_data))} characters')

                return func.HttpResponse(
                    json.dumps(resource_data),
                    status_code=200,
                    mimetype="application/json",
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET",
                        "Access-Control-Allow-Headers": "Content-Type",
                        "Cache-Control": "public, max-age=3600"
                    }
                )
        except Exception as file_error:
            logging.error(
                f"Error loading resource file {resource_name}: {str(file_error)}")

        # Fallback to mock data if file loading fails
        mock_resources = {
            'typeIDToName.json': {"34": "Tritanium", "35": "Pyerite", "36": "Mexallon"},
            'stationIdToName.json': {"60003760": "Jita IV - Moon 4 - Caldari Navy Assembly Plant"},
            'systemIdToSecurity.json': {"30000142": 0.946},
            'structureInfo.json': {},
            'universeList.json': {"jita": {"id": "30000142", "name": "Jita", "region": "10000002"}},
            'regionList.json': [{"id": "10000002", "name": "The Forge"}],
            'stationList.json': ["Jita IV - Moon 4 - Caldari Navy Assembly Plant"],
            'structureList.json': [],
            'functionDurations.json': {}
        }

        # Check if resource exists in mock data
        if resource_name in mock_resources:
            return func.HttpResponse(
                json.dumps(mock_resources[resource_name]),
                status_code=200,
                mimetype="application/json",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET",
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Cache-Control": "public, max-age=3600"
                }
            )

        # Resource not found
        return func.HttpResponse(
            json.dumps({"error": f"Resource '{resource_name}' not found"}),
            status_code=404,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )

    except Exception as e:
        logging.error(f"Error in resources endpoint: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )


# ================================
# EVE-DATA-SITE INTEGRATION ENDPOINTS
# ================================

@app.route(route="market/orders", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET"])
def market_orders(req: func.HttpRequest) -> func.HttpResponse:
    """Get live market orders for EVE-Data-Site"""
    try:
        # Parse query parameters
        type_id = req.params.get('type_id')
        region_id = req.params.get('region_id')
        location_id = req.params.get('location_id')
        is_buy_order = req.params.get('is_buy_order')

        if not type_id:
            return func.HttpResponse(
                json.dumps({"error": "type_id parameter is required"}),
                status_code=400,
                mimetype="application/json",
                headers={"Access-Control-Allow-Origin": "*"}
            )

        # Build dynamic query
        query = """
        SELECT 
            order_id, type_id, region_id, location_id, system_id, station_id,
            price, volume_total, volume_remain, min_volume, is_buy_order,
            duration, issued, range, updated_at
        FROM market_orders_live 
        WHERE type_id = %s AND volume_remain > 0
        """
        params = [type_id]

        if region_id:
            query += " AND region_id = %s"
            params.append(region_id)

        if location_id:
            query += " AND location_id = %s"
            params.append(location_id)

        if is_buy_order is not None:
            query += " AND is_buy_order = %s"
            params.append(1 if is_buy_order.lower() == 'true' else 0)

        query += " ORDER BY price " + \
            ("DESC" if is_buy_order and is_buy_order.lower() == 'true' else "ASC")
        query += " OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY"  # Limit results

        if db:
            orders = db.execute_query(query, params)
            return func.HttpResponse(
                json.dumps({
                    "orders": orders,
                    "count": len(orders),
                    "parameters": {
                        "type_id": type_id,
                        "region_id": region_id,
                        "location_id": location_id,
                        "is_buy_order": is_buy_order
                    }
                }),
                status_code=200,
                mimetype="application/json",
                headers={"Access-Control-Allow-Origin": "*"}
            )
        else:
            return func.HttpResponse(
                json.dumps({"error": "Database connection not available"}),
                status_code=503,
                mimetype="application/json",
                headers={"Access-Control-Allow-Origin": "*"}
            )

    except Exception as e:
        logging.error(f"Error in market orders endpoint: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"}
        )


@app.route(route="universe/regions", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET"])
def universe_regions(req: func.HttpRequest) -> func.HttpResponse:
    """Get regions data for EVE-Data-Site"""
    try:
        query = """
        SELECT region_id, region_name
        FROM regions
        ORDER BY region_name
        """

        if db:
            regions = db.execute_query(query)
            return func.HttpResponse(
                json.dumps({
                    "regions": regions,
                    "count": len(regions)
                }),
                status_code=200,
                mimetype="application/json",
                headers={"Access-Control-Allow-Origin": "*"}
            )
        else:
            return func.HttpResponse(
                json.dumps({"error": "Database connection not available"}),
                status_code=503,
                mimetype="application/json",
                headers={"Access-Control-Allow-Origin": "*"}
            )

    except Exception as e:
        logging.error(f"Error in universe regions endpoint: {str(e)}")
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json",
            headers={"Access-Control-Allow-Origin": "*"}
        )
