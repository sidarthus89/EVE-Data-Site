// azure-function-locations.js
// Azure Function for serving location data from database
//azure-function-deploy/locations/index.js

import { loadRegions } from '../../utils/locationsServer';

const sql = require('mssql');

// Database configuration - use environment variables in production
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    server: process.env.DB_SERVER,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: true, // Use encryption for Azure SQL
        trustServerCertificate: false
    }
};

// Cache for database connections
let poolPromise;

function getPool() {
    if (!poolPromise) {
        poolPromise = sql.connect(dbConfig);
    }
    return poolPromise;
}

async function getAllRegions(req, res, context) {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT DISTINCT 
                region_id,
                region_name,
                COUNT(CASE WHEN location_type = 'station' THEN 1 END) as station_count,
                COUNT(CASE WHEN is_npc = 0 THEN 1 END) as player_structure_count,
                MIN(security_status) as min_security,
                MAX(security_status) as max_security
            FROM v_active_stations 
            GROUP BY region_id, region_name
            ORDER BY region_name
        `);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: result.recordset
        };
    } catch (error) {
        context.log.error('Error fetching regions:', error);
        context.res = {
            status: 500,
            body: { error: 'Failed to fetch regions' }
        };
    }
}

async function getRegionStations(req, res, context) {
    const regionId = req.params.regionId;
    const onlyStructures = req.query.structures === 'true'; // optional flag

    if (!regionId) {
        context.res = {
            status: 400,
            body: { error: 'Region ID is required' }
        };
        return;
    }

    try {
        const pool = await getPool();
        let query = `
            SELECT 
                location_id,
                location_name AS name,
                location_type,
                region_id,
                region_name,
                system_id,
                system_name,
                security_status AS security,
                security_class,
                is_npc,
                last_updated
            FROM v_active_stations
            WHERE region_id = @regionId
        `;

        // If we only want structures, filter for that
        if (onlyStructures) {
            query += ` AND location_type = 'structure'`;
        } else {
            query += ` AND location_type IN ('station', 'structure')`;
        }

        query += ` ORDER BY location_name`;

        const result = await pool.request()
            .input('regionId', sql.Int, regionId)
            .query(query);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=1800'
            },
            body: result.recordset
        };
    } catch (error) {
        context.log.error('Error fetching region stations:', error);
        context.res = {
            status: 500,
            body: { error: 'Failed to fetch region stations' }
        };
    }
}

async function getLocationById(req, res, context) {
    const locationId = req.params.locationId;

    if (!locationId) {
        context.res = {
            status: 400,
            body: { error: 'Location ID is required' }
        };
        return;
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('locationId', sql.BigInt, locationId)
            .query(`
                SELECT 
                    location_id,
                    location_name,
                    location_type,
                    region_id,
                    region_name,
                    system_id,
                    system_name,
                    security_status,
                    security_class,
                    is_npc,
                    last_updated
                FROM v_active_stations 
                WHERE location_id = @locationId
            `);

        if (result.recordset.length === 0) {
            context.res = {
                status: 404,
                body: { error: 'Location not found' }
            };
            return;
        }

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: result.recordset[0]
        };
    } catch (error) {
        context.log.error('Error fetching location:', error);
        context.res = {
            status: 500,
            body: { error: 'Failed to fetch location' }
        };
    }
}

async function searchLocations(req, res, context) {
    const query = req.query.q;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 results

    if (!query || query.length < 3) {
        context.res = {
            status: 400,
            body: { error: 'Search query must be at least 3 characters' }
        };
        return;
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('searchTerm', sql.NVarChar, `%${query}%`)
            .input('limit', sql.Int, limit)
            .query(`
                SELECT TOP (@limit)
                    location_id,
                    location_name,
                    location_type,
                    region_name,
                    system_name,
                    security_status,
                    security_class,
                    is_npc
                FROM v_active_stations 
                WHERE location_name LIKE @searchTerm 
                   OR system_name LIKE @searchTerm 
                   OR region_name LIKE @searchTerm
                ORDER BY 
                    CASE 
                        WHEN location_name LIKE @searchTerm THEN 1
                        WHEN system_name LIKE @searchTerm THEN 2
                        ELSE 3
                    END,
                    location_name
            `);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
            },
            body: result.recordset
        };
    } catch (error) {
        context.log.error('Error searching locations:', error);
        context.res = {
            status: 500,
            body: { error: 'Failed to search locations' }
        };
    }
}

async function getLocationStats(req, res, context) {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                COUNT(*) as total_locations,
                COUNT(CASE WHEN location_type = 'station' THEN 1 END) as stations,
                COUNT(CASE WHEN location_type = 'structure' THEN 1 END) as structures,
                COUNT(CASE WHEN location_type = 'system' THEN 1 END) as systems,
                COUNT(CASE WHEN is_npc = 1 THEN 1 END) as npc_locations,
                COUNT(CASE WHEN is_npc = 0 THEN 1 END) as player_structures,
                COUNT(DISTINCT region_id) as total_regions,
                MAX(last_updated) as last_data_update
            FROM v_active_stations
        `);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: result.recordset[0]
        };
    } catch (error) {
        context.log.error('Error fetching location stats:', error);
        context.res = {
            status: 500,
            body: { error: 'Failed to fetch location stats' }
        };
    }
}

// (legacy getLegacyFormat removed)

// Main Azure Function router
module.exports = async function (context, req) {
    const method = req.method.toUpperCase();
    const path = req.url.split('?')[0]; // Remove query string

    try {
        // Route based on path and method
        if (method === 'GET') {
            if (path.endsWith('/regions')) {
                await getAllRegions(req, res, context);
            } else if (path.match(/\/regions\/\d+\/stations$/)) {
                await getRegionStations(req, res, context);
            } else if (path.match(/\/locations\/\d+$/)) {
                await getLocationById(req, res, context);
            } else if (path.endsWith('/search')) {
                await searchLocations(req, res, context);
            } else if (path.endsWith('/stats')) {
                await getLocationStats(req, res, context);
            } else {
                context.res = {
                    status: 404,
                    body: { error: 'Endpoint not found' }
                };
            }
        } else {
            context.res = {
                status: 405,
                body: { error: 'Method not allowed' }
            };
        }
    } catch (error) {
        context.log.error('Unhandled error:', error);
        context.res = {
            status: 500,
            body: { error: 'Internal server error' }
        };
    }
};
