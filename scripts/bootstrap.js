import dotenv from 'dotenv';
import fs from 'fs/promises';
import fetch from 'node-fetch';
import path from 'path';

dotenv.config({ path: '../.env.local' });

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
    console.log('🌍 Fetching regions data...');
    const regionIds = await fetchESI('/universe/regions/');
    const regions = [];

    for (const regionId of regionIds) {
        try {
            const regionInfo = await fetchESI(`/universe/regions/${regionId}/`);
            regions.push({
                region_id: regionId,
                region_name: regionInfo.name
            });
            console.log(`✅ Added region: ${regionInfo.name}`);
        } catch (err) {
            console.warn(`⚠️ Region ${regionId} failed: ${err.message}`);
        }
    }

    return regions;
}

async function fetchStructuresData() {
    console.log('🏗️ Fetching market structures...');
    let structureIds = [];

    try {
        structureIds = await fetchESIPaged('/universe/structures/?filter=market');
        console.log(`Found ${structureIds.length} potential market structures`);
    } catch (e) {
        console.log('Failed to fetch market structures from ESI:', e.message);
        return [];
    }

    const structures = [];

    for (const structureId of structureIds.slice(0, 100)) { // Limit for testing
        try {
            const hasAccess = await isStructureMarketAccessible(structureId);
            if (!hasAccess) {
                console.log(`🚫 No market access to structure ${structureId}`);
                continue;
            }

            const structureInfo = await fetchESI(`/universe/structures/${structureId}/`);
            let systemInfo = null;
            let regionId = null;
            let regionName = 'Unknown';

            if (structureInfo.system_id) {
                try {
                    systemInfo = await fetchESI(`/universe/systems/${structureInfo.system_id}/`);
                    regionId = systemInfo.region_id;
                    const regionInfo = await fetchESI(`/universe/regions/${regionId}/`);
                    regionName = regionInfo.name;
                } catch (e) {
                    console.warn(`Failed to get region info for structure ${structureId}`);
                }
            }

            structures.push({
                structure_id: structureId,
                name: structureInfo.name,
                system_id: structureInfo.system_id,
                region_id: regionId,
                region_name: regionName,
                type_id: structureInfo.type_id,
                is_npc: false
            });

            console.log(`✅ Added structure: ${structureInfo.name}`);
        } catch (err) {
            console.warn(`⚠️ Structure ${structureId} failed: ${err.message}`);
        }
    }

    return structures;
}

async function main() {
    console.log('📦 Starting bootstrap process...');

    try {
        // Fetch regions data
        const regions = await fetchRegionsData();

        // Fetch structures data  
        const structures = await fetchStructuresData();

        // Write to the correct locations
        const regionsPath = path.join(process.cwd(), 'public', 'data', 'regions.json');
        const structuresPath = path.join(process.cwd(), 'public', 'data', 'structures.json');

        await fs.writeFile(regionsPath, JSON.stringify(regions, null, 2));
        console.log(`✅ Updated ${regionsPath} with ${regions.length} regions`);

        await fs.writeFile(structuresPath, JSON.stringify(structures, null, 2));
        console.log(`✅ Updated ${structuresPath} with ${structures.length} structures`);

        console.log('✅ Bootstrap complete!');
    } catch (error) {
        console.error('❌ Bootstrap failed:', error);
        process.exit(1);
    }
}

// Call main if executed directly
main().catch(err => {
    console.error('Bootstrap script failed:', err);
    process.exit(1);
});