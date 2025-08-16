// worker-api\utils\locations.js

// Utility to fetch locations.json at runtime (for dev/local worker only)
export async function getLocationsJSONResponse(env) {
    let data = {};

    try {
        if (env?.LOCATIONS) {
            // ✅ Production: fetch from KV
            const raw = await env.LOCATIONS.get('locations.json');
            if (!raw) throw new Error('KV: locations.json not found');
            data = JSON.parse(raw);
        } else {
            // 🧪 Dev: fetch from local Vite server
            const res = await fetch('http://127.0.0.1:5173/data/locations.json');
            if (!res.ok) throw new Error('Dev fetch failed');
            data = await res.json();
        }
    } catch (err) {
        return new Response(JSON.stringify({
            error: 'Could not load locations.json',
            details: err.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            }
        });
    }

    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }
    });
}


/**
 * Get station name by ID
 * @param {number|string} stationID
 * @returns {string}
 */
export function getStationName(stationID) {
    return locations[stationID]?.name ?? 'Unknown Station';
}

/**
 * Get station security level by ID
 * @param {number|string} stationID
 * @returns {number}
 */
export function getSecurityLevel(stationID) {
    return locations[stationID]?.security ?? 0.0;
}

/**
 * Get region name by region ID
 * @param {number|string} regionID
 * @returns {string}
 */
export function getRegionName(regionID) {
    const idNum = Number(regionID);
    for (const loc of Object.values(locations)) {
        if (loc.regionID === idNum) {
            return loc.regionName;
        }
    }
    return 'Unknown Region';
}

/**
 * Get all regions as an array [{ regionID, name }]
 * Sorted alphabetically by name
 * @returns {Array<{regionID:string, name:string}>}
 */
export function getAllRegions() {
    const regionMap = {};

    Object.values(locations).forEach(loc => {
        const { regionID, regionName } = loc;
        if (regionID && regionName) regionMap[regionID] = regionName;
    });

    return Object.entries(regionMap)
        .map(([regionID, name]) => ({ regionID, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
