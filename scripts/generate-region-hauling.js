#!/usr/bin/env node
// Generate static region hauling snapshots using ESI and save under public/data/region_hauling
// Env vars:
//   FROM_REGIONS: comma-separated region IDs (default major hubs)
//   TO_REGIONS: comma-separated region IDs (default same as FROM_REGIONS)
//   MAX_ITEMS: limit number of items to scan from market.json (default 300)
//   TOP_N: number of routes to keep per pair (default 50)
//   CONCURRENCY: number of parallel item fetches (default 4)

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ESI_BASE = 'https://esi.evetech.net/latest';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeFetchJson(url, retries = 1) {
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) throw new Error('non-json');
            return await res.json();
        } catch (e) {
            if (i === retries) throw e;
            await sleep(500 * Math.pow(2, i));
        }
    }
}

async function loadMarketTree(repoRoot) {
    const candidates = [
        path.join(repoRoot, 'public', 'data', 'market.json'),
        path.join(repoRoot, 'src', 'data', 'market.json'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            const raw = await fsp.readFile(p, 'utf-8');
            return JSON.parse(raw);
        }
    }
    throw new Error('market.json not found in public/data or src/data');
}

function collectItems(tree, maxItems) {
    const items = [];
    function traverse(node) {
        if (items.length >= maxItems) return;
        if (node && Array.isArray(node.items)) {
            for (const it of node.items) {
                items.push({ typeId: Number(it.typeID), name: it.typeName, volume: it.volume || 0.01 });
                if (items.length >= maxItems) return;
            }
        }
        if (node && typeof node === 'object') {
            for (const [k, v] of Object.entries(node)) {
                if (k === 'items' || k === '_info') continue;
                if (v && typeof v === 'object') traverse(v);
                if (items.length >= maxItems) return;
            }
        }
    }
    traverse(tree);
    return items;
}

async function fetchRegionOrdersForType(regionId, typeId) {
    const url = `${ESI_BASE}/markets/${regionId}/orders/?type_id=${typeId}`;
    const orders = await safeFetchJson(url, 1);
    const sellOrders = orders.filter(o => !o.is_buy_order);
    const buyOrders = orders.filter(o => o.is_buy_order);
    return { sellOrders, buyOrders };
}

function computeOpportunity(typeId, itemName, itemVol, sellOrders, buyOrders) {
    if (!sellOrders.length || !buyOrders.length) return null;
    const bestSellPrice = Math.min(...sellOrders.map(o => o.price));
    const bestBuyPrice = Math.max(...buyOrders.map(o => o.price));
    if (!(bestBuyPrice > bestSellPrice)) return null;
    const sellOrder = sellOrders.find(o => o.price === bestSellPrice) || sellOrders[0];
    const buyOrder = buyOrders.find(o => o.price === bestBuyPrice) || buyOrders[0];
    const profit = bestBuyPrice - bestSellPrice;
    const profitMargin = (profit / bestSellPrice) * 100;
    const maxVolume = Math.min(sellOrder?.volume_remain || 0, buyOrder?.volume_remain || 0);
    return {
        type_id: typeId,
        item_name: itemName,
        item_volume: itemVol,
        origin_id: sellOrder?.location_id || 0,
        destination_id: buyOrder?.location_id || 0,
        sell_price: bestSellPrice,
        buy_price: bestBuyPrice,
        profit_per_unit: profit,
        profit_margin: profitMargin,
        max_volume: maxVolume,
    };
}

async function generateForPair(fromRegion, toRegion, items, concurrency, topN) {
    const results = [];
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            const { typeId, name, volume } = items[i];
            try {
                const [from, to] = await Promise.all([
                    fetchRegionOrdersForType(fromRegion, typeId),
                    fetchRegionOrdersForType(toRegion, typeId)
                ]);
                const opp = computeOpportunity(typeId, name, volume, from.sellOrders, to.buyOrders);
                if (opp) results.push(opp);
            } catch (e) {
                // ignore per-item errors to keep going
            }
            await sleep(50); // small pacing for ESI
        }
    }
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return results
        .filter(r => r.profit_margin > 1)
        .sort((a, b) => b.profit_margin - a.profit_margin)
        .slice(0, topN);
}

async function main() {
    const repoRoot = process.cwd();
    const outDir = path.join(repoRoot, 'public', 'data', 'region_hauling');
    await fsp.mkdir(outDir, { recursive: true });

    const defaultRegions = [10000002, 10000043, 10000032, 10000030, 10000042];
    const fromRegions = (process.env.FROM_REGIONS || defaultRegions.join(',')).split(',').map(s => Number(s.trim())).filter(Boolean);
    const toRegions = (process.env.TO_REGIONS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
    const itemLimit = Number(process.env.MAX_ITEMS || 300);
    const topN = Number(process.env.TOP_N || 50);
    const concurrency = Math.max(1, Number(process.env.CONCURRENCY || 4));

    const tree = await loadMarketTree(repoRoot);
    const items = collectItems(tree, itemLimit);

    for (const from of fromRegions) {
        const targets = (toRegions.length ? toRegions : [from, ...fromRegions.filter(r => r !== from)]);
        for (const to of targets) {
            console.log(`Generating region hauling ${from} -> ${to} with ${items.length} items...`);
            const routes = await generateForPair(from, to, items, concurrency, topN);
            const payload = { origin_region_id: from, destination_region_id: to, count: routes.length, routes };
            const outPath = path.join(outDir, `${from}-${to}.json`);
            await fsp.writeFile(outPath, JSON.stringify(payload));
            console.log(`Wrote ${routes.length} routes to ${path.relative(repoRoot, outPath)}`);
        }
    }
}

main().catch(err => {
    console.error('Snapshot generation failed:', err);
    process.exit(1);
});
