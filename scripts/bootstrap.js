import dotenv from 'dotenv';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: '../.env.local' });
// Resolve project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const ESI_BASE = 'https://esi.evetech.net/latest';
const ESI_DATASOURCE = 'tranquility';
const HEADERS = { 'User-Agent': 'EVE-Data-Site-Bootstrap' };

const ACCESS_TOKEN = process.env.ESI_ACCESS_TOKEN;
const CHARACTER_ID = process.env.ESI_CHARACTER_ID;

if (!ACCESS_TOKEN || !CHARACTER_ID) {
    console.error('❌ Missing ESI_ACCESS_TOKEN or ESI_CHARACTER_ID in .env.local');
    process.exit(1);
}

class RateLimiter {
    constructor(perSecond) {
        this.window = 1000;
        this.max = perSecond;
        this.times = [];
    }
    async throttle() {
        const now = Date.now();
        this.times = this.times.filter(t => now - t < this.window);
        if (this.times.length >= this.max) {
            const oldest = Math.min(...this.times);
            const wait = this.window - (now - oldest);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
            return this.throttle();
        }
        this.times.push(now);
    }
}

const rateLimiter = new RateLimiter(50);

function buildEsiUrl(endpoint, params = {}) {
    const hasQuery = endpoint.indexOf('?') !== -1;
    const base = `${ESI_BASE}${endpoint}${hasQuery ? '&' : '?'}datasource=${ESI_DATASOURCE}`;
    const extra = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    return extra ? `${base}&${extra}` : base;
}

async function fetchESI(endpoint, retries = 3) {
    await rateLimiter.throttle();
    for (let i = 0; i < retries; i++) {
        try {
            const url = buildEsiUrl(endpoint);
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`ESI ${resp.status} ${resp.statusText}`);
            return await resp.json();
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function fetchESIPaged(endpoint, opts = {}) {
    const results = [];
    let page = 1;
    let totalPages = null;
    while (true) {
        await rateLimiter.throttle();
        try {
            const url = buildEsiUrl(endpoint, { page });
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`ESI ${resp.status} ${resp.statusText}`);
            const pageJson = await resp.json();
            if (Array.isArray(pageJson) && pageJson.length === 0) break;
            if (Array.isArray(pageJson)) results.push(...pageJson);

            if (totalPages === null) {
                const xp = resp.headers.get('x-pages');
                if (xp) totalPages = parseInt(xp, 10);
                else {
                    const link = resp.headers.get('link');
                    if (link) {
                        const m = link.match(/<[^>]+[?&]page=(\d+)[^>]*>;\s*rel="last"/i);
                        if (m) totalPages = parseInt(m[1], 10);
                    }
                }
            }

            if (totalPages !== null && page >= totalPages) break;
            if (Array.isArray(pageJson) && pageJson.length < 1) break;
            page++;
        } catch (e) {
            throw e;
        }
    }
    return results;
}

async function isStructureMarketAccessible(structureId) {
    try {
        await rateLimiter.throttle();
        const url = `${ESI_BASE}/markets/structures/${structureId}/?datasource=${ESI_DATASOURCE}`;
        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        return resp.status === 200;
    } catch (e) {
        return false;
    }
}

async function fetchRegionsData() {
    const regionIds = await fetchESI('/universe/regions/');
    const regions = [];

    for (const regionId of regionIds) {
        try {
            const regionInfo = await fetchESI(`/universe/regions/${regionId}/`);
            regions.push({
                region_id: regionId,
                region_name: regionInfo.name
            });
        } catch (err) {
            console.warn(`⚠️ Region ${regionId} failed: ${err.message}`);
        }
    }

    return regions;
}

// Fetch NPC stations that offer market service
async function fetchStationsData() {
    let stationIds = [];
    try {
        stationIds = await fetchESIPaged('/universe/stations/');
    } catch (e) {
        console.warn('Failed to fetch station IDs:', e.message);
        return [];
    }
    const stations = [];
    for (const id of stationIds) {
        try {
            const info = await fetchESI(`/universe/stations/${id}/`);
            if (Array.isArray(info.services) && info.services.includes('market')) {
                stations.push({
                    station_id: id,
                    name: info.name,
                    system_id: info.system_id,
                    region_id: info.region_id,
                    security_status: info.security_status,
                    services: info.services
                });
            }
        } catch (err) {
            console.warn(`Station ${id} failed:`, err.message);
        }
    }
    return stations;
}

// Fetch player structures that have market access
async function fetchStructuresData() {
    let structIds = [];
    try {
        structIds = await fetchESIPaged('/universe/structures/');
    } catch (e) {
        console.warn('Failed to list structures:', e.message);
        return [];
    }
    const structures = [];
    for (let i = 0; i < structIds.length; i++) {
        const id = structIds[i];
        try {
            const accessible = await isStructureMarketAccessible(id);
            if (!accessible) {
                continue;
            }
            const info = await fetchESI(`/universe/structures/${id}/`);
            structures.push({
                structure_id: id,
                name: info.name,
                system_id: info.system_id,
                region_id: info.region_id,
                type_id: info.type_id,
                is_npc: false
            });
        } catch (err) {
            console.warn(`⚠️ Structure ${id} failed:`, err.message);
        }
    }
    return structures;
}

async function main() {
    try {
        // Load static stations data from local file
        const stationsJson = await fs.readFile(path.join(ROOT, 'src', 'data', 'stations.json'), 'utf8');
        const stations = JSON.parse(stationsJson);
        const structures = await fetchStructuresData();
        // Derive regions where markets exist
        const regionSet = new Set();
        stations.forEach(s => regionSet.add(s.region_id));
        structures.forEach(s => regionSet.add(s.region_id));
        const regions = [];
        for (const regionId of regionSet) {
            try {
                const info = await fetchESI(`/universe/regions/${regionId}/`);
                regions.push({ region_id: regionId, region_name: info.name });
            } catch (err) {
                console.warn(`Region ${regionId} failed:`, err.message);
            }
        }
        // Write to the correct locations
        const regionsPath = path.join(ROOT, 'public', 'data', 'regions.json');
        const stationsPath = path.join(ROOT, 'src', 'data', 'stations.json');
        const structuresPath = path.join(ROOT, 'public', 'data', 'structures.json');
        // Write stations and structures first (static)
        // Static stations.json is maintained manually; skipping write
        await fs.writeFile(structuresPath, JSON.stringify(structures, null, 2));
        // Then write dynamic regions
        await fs.writeFile(regionsPath, JSON.stringify(regions, null, 2));
    } catch (error) {
        process.exit(1);
    }
}

// Call main if executed directly
main().catch(err => {
    console.error('Bootstrap script failed:', err);
    process.exit(1);
});