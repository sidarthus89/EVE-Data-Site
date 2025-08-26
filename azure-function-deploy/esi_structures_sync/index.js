const fs = require('fs').promises;
const path = require('path');

// ESI Configuration
const ESI_BASE = 'https://esi.evetech.net/latest';
const ESI_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
const HEADERS = { 'User-Agent': 'EVE-Data-Site-Azure-Function' };

// Refresh ESI access token using refresh token
async function refreshAccessToken() {
    const clientId = process.env.ESI_CLIENT_ID;
    const clientSecret = process.env.ESI_CLIENT_SECRET;
    const refreshToken = process.env.ESI_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('ESI_CLIENT_ID, ESI_CLIENT_SECRET, and ESI_REFRESH_TOKEN must be configured');
    }

    const response = await fetch(ESI_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${response.status} - ${error}`);
    }

    const tokenData = await response.json();
    return tokenData.access_token;
}

// Helper function to delay requests
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to set CORS headers
function setCorsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
}

// Fetch from ESI with optional authentication
async function fetchESI(endpoint, accessToken = null) {
    const headers = { ...HEADERS };
    if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${ESI_BASE}${endpoint}`, { headers });
    if (!response.ok) {
        throw new Error(`ESI request failed: ${endpoint} (${response.status})`);
    }
    return response.json();
}

// Check if character has market access to a structure
async function checkMarketAccess(structureId, accessToken) {
    try {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            ...HEADERS
        };
        const response = await fetch(`${ESI_BASE}/markets/structures/${structureId}/`, { headers });
        return response.status === 200;
    } catch (error) {
        return false;
    }
}

// Get all regions for system lookup
async function getAllRegions() {
    const regionIds = await fetchESI('/universe/regions/');
    const regions = new Map();

    for (const regionId of regionIds) {
        try {
            const region = await fetchESI(`/universe/regions/${regionId}/`);
            regions.set(regionId, region.name);
            await delay(10); // Small delay to avoid rate limits
        } catch (error) {
            console.warn(`Failed to fetch region ${regionId}:`, error.message);
        }
    }

    return regions;
}

// Get system details for security status
async function getSystemDetails(systemId) {
    try {
        return await fetchESI(`/universe/systems/${systemId}/`);
    } catch (error) {
        console.warn(`Failed to fetch system ${systemId}:`, error.message);
        return null;
    }
}

module.exports = async function (context, req) {
    const startTime = Date.now();

    try {
        context.log('🏗️ Starting ESI structures sync...');

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            context.res = {
                status: 200,
                headers: setCorsHeaders()
            };
            return;
        }

        // Get fresh access token using refresh token
        context.log('🔑 Refreshing ESI access token...');
        const accessToken = await refreshAccessToken();
        context.log('✅ Access token refreshed successfully');

        const characterId = process.env.ESI_CHARACTER_ID;
        if (!characterId) {
            throw new Error('ESI_CHARACTER_ID must be configured in application settings');
        }

        context.log('📍 Fetching regions for lookup...');
        const regionMap = await getAllRegions();
        context.log(`📍 Loaded ${regionMap.size} regions`);

        context.log('🏗️ Fetching public market structures...');
        const structureIds = await fetchESI('/universe/structures/?filter=market');
        context.log(`🏗️ Found ${structureIds.length} public market structures`);

        const structures = [];
        const batchSize = 50; // Process in batches to avoid timeouts

        for (let i = 0; i < structureIds.length; i += batchSize) {
            const batch = structureIds.slice(i, i + batchSize);
            context.log(`🏗️ Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(structureIds.length / batchSize)} (${batch.length} structures)`);

            for (const structureId of batch) {
                try {
                    // Check market access first
                    const hasMarketAccess = await checkMarketAccess(structureId, accessToken);
                    if (!hasMarketAccess) {
                        context.log(`🚫 No market access to structure ${structureId}`);
                        continue;
                    }

                    // Get structure details
                    const structure = await fetchESI(`/universe/structures/${structureId}/`, accessToken);

                    // Get system details for security status
                    const system = await getSystemDetails(structure.system_id);

                    const structureData = {
                        stationID: structureId,
                        locationName: structure.name,
                        name: structure.name, // Keep both for compatibility
                        systemID: structure.system_id,
                        systemName: system?.name || 'Unknown',
                        regionID: system?.region_id || null,
                        regionName: regionMap.get(system?.region_id) || 'Unknown',
                        typeID: structure.type_id,
                        security: system?.security_status || null,
                        is_npc: false,
                        type: 'player',
                        updated: new Date().toISOString()
                    };

                    structures.push(structureData);
                    context.log(`✅ Added structure: ${structure.name} (${structureId})`);

                    await delay(100); // Rate limiting
                } catch (error) {
                    context.log(`⚠️ Failed to process structure ${structureId}: ${error.message}`);
                }
            }

            // Longer delay between batches
            if (i + batchSize < structureIds.length) {
                await delay(2000);
            }
        }

        context.log(`🏗️ Successfully processed ${structures.length} structures`);

        // Save to file (in Azure Functions, this would be to blob storage or database)
        const outputPath = path.resolve(__dirname, '..', '..', 'public', 'data', 'structures.json');

        try {
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(structures, null, 2));
            context.log(`💾 Saved structures to ${outputPath}`);
        } catch (writeError) {
            context.log(`⚠️ Could not write to file system: ${writeError.message}`);
            // In production, you'd save to blob storage or database instead
        }

        const executionTime = (Date.now() - startTime) / 1000;

        context.res = {
            status: 200,
            headers: setCorsHeaders(),
            body: {
                success: true,
                message: 'Structures sync completed successfully',
                structures_count: structures.length,
                execution_time_seconds: executionTime,
                timestamp: new Date().toISOString()
            }
        };

    } catch (error) {
        context.log.error('❌ ESI structures sync failed:', error);

        const executionTime = (Date.now() - startTime) / 1000;

        context.res = {
            status: 500,
            headers: setCorsHeaders(),
            body: {
                success: false,
                error: error.message,
                execution_time_seconds: executionTime,
                timestamp: new Date().toISOString()
            }
        };
    }
};
