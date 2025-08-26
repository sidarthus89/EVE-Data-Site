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

async function getAllStationIDs() {
    return await fetchESI('/universe/stations/');
}

async function getStationDetails(id) {
    return await fetchESI(`/universe/stations/${id}/`);
}

async function getPublicMarketStructures() {
    return await fetchESI('/universe/structures/?filter=market');
}

async function getStructureDetails(id) {
    return await fetchESI(`/universe/structures/${id}/`, true);
}

async function getRegionDetails(id) {
    return await fetchESI(`/universe/regions/${id}/`);
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
                name: s.name,
                systemID: s.system_id,
                regionID: s.region_id,
                security: s.security_status
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
                structureID: id,
                name: s.name,
                systemID: s.system_id,
                regionID: s.region_id,
                typeID: s.type_id
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

    await fs.mkdir('./public/data', { recursive: true });
    await fs.writeFile('./public/data/stations.json', JSON.stringify(stations, null, 2));
    await fs.writeFile('./public/data/structures.json', JSON.stringify(structures, null, 2));
    await fs.writeFile('./public/data/regions.json', JSON.stringify(regions, null, 2));

    console.log('✅ Bootstrap complete: stations, structures, regions written to public/data/');
}

main().catch(err => console.error('❌ Bootstrap failed:', err));