import dotenv from 'dotenv';
import fs from 'fs/promises';
import fetch from 'node-fetch';

dotenv.config({ path: '../.env.local' });

const ESI_BASE = 'https://esi.evetech.net/latest';
const HEADERS = { 'User-Agent': 'EVE-Data-Site-Bootstrap' };

const ACCESS_TOKEN = process.env.ESI_ACCESS_TOKEN;
const CHARACTER_ID = process.env.ESI_CHARACTER_ID;

if (!ACCESS_TOKEN || !CHARACTER_ID) {
    console.error('❌ Missing ESI_ACCESS_TOKEN or ESI_CHARACTER_ID in .env.local');
    process.exit(1);
}

function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}

async function fetchESI(endpoint, auth = false) {
    const headers = { ...HEADERS };
    if (auth) headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;

    const res = await fetch(`${ESI_BASE}${endpoint}`, { headers });
    if (!res.ok) throw new Error(`Failed: ${endpoint} (${res.status})`);
    return res.json();
}

async function fetchMarketAccess(structureID) {
    const headers = {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        ...HEADERS
    };
    const res = await fetch(`${ESI_BASE}/markets/structures/${structureID}/`, { headers });
    return res.status === 200;
}

async function getAllRegions() {
    return await fetchESI('/universe/regions/');
}

async function getRegionDetails(id) {
    return await fetchESI(`/universe/regions/${id}/`);
}

async function getConstellationsInRegion(regionId) {
    const region = await getRegionDetails(regionId);
    return region.constellations || [];
}

async function getConstellationDetails(id) {
    return await fetchESI(`/universe/constellations/${id}/`);
}

async function getSystemDetails(id) {
    return await fetchESI(`/universe/systems/${id}/`);
}

async function getStationDetails(id) {
    return await fetchESI(`/universe/stations/${id}/`);
}

async function main() {
    const stations = [];
    const structures = [];
    const regionMap = new Map();

    console.log('📦 Fetching station data...');
    const stationIDs = await getAllStationIDs();
    for (const id of stationIDs.slice(0, 1000)) {
        try {
            const s = await getStationDetails(id);
            stations.push({
                stationID: id,
                station_id: id,  // Add for compatibility
                name: s.name,
                systemID: s.system_id,
                regionID: s.region_id,
                region_id: s.region_id,  // Add for compatibility
                region_name: null,  // Will be resolved later
                security: s.security_status,
                security_status: s.security_status,  // Add for compatibility
                is_npc: true,
                type: 'station'
            });
            regionMap.set(s.region_id, true);
            await delay(50);
        } catch (err) {
            console.warn(`⚠️ Station ${id} failed: ${err.message}`);
        }
    }

    console.log('🏗️ Fetching public market structures...');
    const structureIDs = await getPublicMarketStructures();
    for (const id of structureIDs) {
        try {
            const hasAccess = await fetchMarketAccess(id);
            if (!hasAccess) {
                console.log(`🚫 No market access to structure ${id}`);
                continue;
            }

            const s = await getStructureDetails(id);
            structures.push({
                stationID: id,  // Changed from structureID to stationID for consistency
                locationName: s.name,  // Changed from name to locationName
                name: s.name,  // Keep both for compatibility
                systemID: s.system_id,
                regionID: s.region_id,
                regionName: null,  // Will be resolved later
                typeID: s.type_id,
                security: null,  // Structures don't have direct security, would need system lookup
                is_npc: false,  // Player structures are not NPC
                type: 'structure'
            });
            regionMap.set(s.region_id, true);
            console.log(`✅ Added structure ${id}: ${s.name}`);
            await delay(100);
        } catch (err) {
            console.warn(`⚠️ Structure ${id} failed: ${err.message}`);
        }
    }

    console.log('🌍 Resolving region names...');
    const regionIDs = Array.from(regionMap.keys());
    const regions = [];
    for (const id of regionIDs) {
        try {
            const r = await getRegionDetails(id);
            regions.push({ regionID: id, regionName: r.name });
            await delay(50);
        } catch (err) {
            console.warn(`⚠️ Region ${id} failed: ${err.message}`);
        }
    }

    // Now update stations and structures with region names
    const regionLookup = new Map(regions.map(r => [r.regionID, r.regionName]));
    stations.forEach(station => {
        station.region_name = regionLookup.get(station.regionID) || 'Unknown';
    });
    structures.forEach(structure => {
        structure.regionName = regionLookup.get(structure.regionID) || 'Unknown';
    });

    await fs.mkdir('./public/data', { recursive: true });
    await fs.writeFile('./public/data/stations.json', JSON.stringify(stations, null, 2));
    await fs.writeFile('./public/data/structures.json', JSON.stringify(structures, null, 2));
    await fs.writeFile('./public/data/regions.json', JSON.stringify(regions, null, 2));

    console.log('✅ Bootstrap complete: stations, structures, regions written to public/data/');
}

main().catch(err => console.error('❌ Bootstrap failed:', err));