// Azure Function: region_hauling_scheduler
// Timer-triggered: generates region hauling snapshots for configured hubs
// SQL-free: computes routes by comparing best_quotes from precomputed region_orders snapshots

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const telemetry = require('../utils/telemetry');
const { upsertDataToAll } = require('../utils/github');

// CONFIG: Set these in Azure Function App settings or local.settings.json
const HUB_REGIONS = process.env.HUB_REGIONS ? process.env.HUB_REGIONS.split(',').map(s => Number(s.trim())) : [10000002, 10000043, 10000032, 10000030, 10000042];
const REFRESH_INTERVAL_MIN = Number(process.env.REFRESH_INTERVAL_MIN || 30);
// Optional legacy email settings (unused when using Azure Monitor alerts)
const EMAIL_CONNECTION_STRING = process.env.AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING;
const EMAIL_TO = process.env.ALERT_EMAIL_TO;
const EMAIL_FROM = process.env.ALERT_EMAIL_FROM;
const TREND_THRESHOLD = Number(process.env.TREND_THRESHOLD || 5);
const TREND_WINDOW_MIN = Number(process.env.TREND_WINDOW_MIN || 1440); // 1 day

const SNAPSHOT_DIR = path.join(__dirname, '../../public/data/region_hauling');
const SNAPSHOT_PREFIX = 'region_hauling';

// GitHub read configuration (mirror of utils/github.js defaults)
const OWNER = process.env.GITHUB_OWNER || 'sidarthus89';
const REPO = process.env.GITHUB_REPO || 'EVE-Data-Site';
const BRANCH = process.env.GITHUB_BRANCH || 'gh-pages';

function dataPrefixForBranch(branch) {
    return branch === 'gh-pages' ? 'data' : 'public/data';
}

function rawUrlFor(pathRel) {
    return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(BRANCH)}/${pathRel}`;
}

let requestLog = {};

async function fetchRegionOrdersSnapshot(regionId) {
    const prefix = dataPrefixForBranch(BRANCH);
    const candidates = [
        `${prefix}/region_orders/${regionId}.json`,
        `${prefix}/region-orders/${regionId}.json`,
        `${prefix}/regions/${regionId}.json`,
    ];
    for (const rel of candidates) {
        const url = rawUrlFor(rel);
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'EVE-Data-Site-Scheduler' } });
            if (!res.ok) continue;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) continue;
            return await res.json();
        } catch { /* try next */ }
    }
    throw new Error(`region_orders snapshot not found for ${regionId}`);
}

function computeRoutesFromSnapshots(originRegionId, destinationRegionId, snapA, snapB, limit = 5000) {
    const routes = [];
    const a = snapA && snapA.best_quotes || {};
    const b = snapB && snapB.best_quotes || {};
    for (const t of Object.keys(a)) {
        const sa = a[t]?.best_sell;
        const bb = b[t]?.best_buy;
        if (!sa || !bb) continue;
        const profit = Number(bb.price || 0) - Number(sa.price || 0);
        if (profit <= 0) continue;
        const qty = Math.min(Number(sa.volume_remain || 0), Number(bb.volume_remain || 0));
        const roi = sa.price > 0 ? (profit / Number(sa.price)) * 100 : 0;
        routes.push({
            type_id: Number(t),
            origin_id: Number(sa.location_id),
            destination_id: Number(bb.location_id),
            sell_price: Number(sa.price),
            buy_price: Number(bb.price),
            profit_per_unit: profit,
            profit_margin: roi,
            max_volume: qty,
            origin_region_id: Number(originRegionId),
            destination_region_id: Number(destinationRegionId)
        });
    }
    return routes
        .sort((x, y) => (Number(y.profit_per_unit) - Number(x.profit_per_unit)))
        .slice(0, limit);
}

async function saveSnapshotToRepo(fromRegion, toRegion, routes) {
    const payload = JSON.stringify({ origin_region_id: fromRegion, destination_region_id: toRegion, count: routes.length, routes });
    try {
        if (!fs.existsSync(SNAPSHOT_DIR)) {
            fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        }
        const fileName = path.join(SNAPSHOT_DIR, `${fromRegion}-${toRegion}.json`);
        fs.writeFileSync(fileName, payload);
        telemetry.trackEvent('SNAPSHOT_SAVED', {
            area: 'region_hauling_scheduler',
            file: `${fromRegion}-${toRegion}.json`,
            origin_region_id: String(fromRegion),
            destination_region_id: String(toRegion),
            count: String(routes.length)
        });
    } catch (e) {
        telemetry.trackException(e, { area: 'fs.writeSnapshot', from: String(fromRegion), to: String(toRegion) });
    }
    telemetry.trackEvent('SNAPSHOT_READY', {
        area: 'region_hauling_scheduler',
        origin_region_id: String(fromRegion),
        destination_region_id: String(toRegion),
        count: String(routes.length)
    });

    // Also upsert to GitHub repo so GitHub Pages serves the latest JSON
    const repoPath = `region_hauling/${fromRegion}-${toRegion}.json`;
    try {
        const results = await upsertDataToAll(repoPath, payload, `chore(region-hauling): update ${fromRegion}-${toRegion}.json`);
        telemetry.trackEvent('SNAPSHOT_COMMITTED', { path: repoPath, targets: JSON.stringify(results) });
    } catch (e) {
        telemetry.trackException(e, { area: 'github.upsertFile', path: repoPath });
    }
}

async function sendEmailAlert(subject, body) {
    // Prefer Azure Monitor alerting via Log Analytics. Keep email as optional fallback.
    telemetry.trackEvent('TREND_ALERT_ENQUEUED', { subject, preview: body.slice(0, 100) });
    if (!EMAIL_CONNECTION_STRING || !EMAIL_TO || !EMAIL_FROM) return;
    try {
        const { EmailClient } = require('@azure/communication-email');
        const emailClient = new EmailClient(EMAIL_CONNECTION_STRING);
        const message = {
            senderAddress: EMAIL_FROM,
            recipients: [{ address: EMAIL_TO }],
            subject,
            body,
            contentType: 'text/plain'
        };
        await emailClient.send(message);
        telemetry.trackEvent('TREND_ALERT_EMAIL_SENT');
    } catch (e) {
        telemetry.trackException(e, { area: 'sendEmailAlert' });
    }
}

module.exports = async function (context, timer) {
    telemetry.init();
    telemetry.trackEvent('SCHEDULER_START', { schedule: 'region_hauling', hubs: String(HUB_REGIONS.length) });
    // 1. Scheduled job: refresh hub combos by reading region_orders snapshots and computing deltas (SQL-free)
    for (const from of HUB_REGIONS) {
        for (const to of HUB_REGIONS) {
            if (from === to) continue;
            context.log(`Computing SQL-free routes for ${from} -> ${to}`);
            telemetry.trackTrace('Computing routes from snapshots', { from: String(from), to: String(to) });
            let routes = [];
            try {
                const [snapA, snapB] = await Promise.all([
                    fetchRegionOrdersSnapshot(from),
                    fetchRegionOrdersSnapshot(to)
                ]);
                routes = computeRoutesFromSnapshots(from, to, snapA, snapB);
            } catch (e) {
                telemetry.trackException(e, { area: 'scheduler.computeRoutes', from: String(from), to: String(to) });
            }
            await saveSnapshotToRepo(from, to, routes);
        }
    }
    // 2. On-demand: check requestLog for non-hub combos
    const now = Date.now();
    for (const combo in requestLog) {
        const log = requestLog[combo].filter(ts => now - ts < TREND_WINDOW_MIN * 60 * 1000);
        if (log.length >= TREND_THRESHOLD) {
            telemetry.trackEvent('TREND_ALERT', { combo, count: String(log.length), windowMin: String(TREND_WINDOW_MIN) });
            await sendEmailAlert(
                `Region Hauling Trend: ${combo}`,
                `Combo ${combo} requested ${log.length} times in last ${TREND_WINDOW_MIN} min.`
            );
            requestLog[combo] = []; // reset after alert
        }
    }
    // 3. Clear old logs
    for (const combo in requestLog) {
        requestLog[combo] = requestLog[combo].filter(ts => now - ts < TREND_WINDOW_MIN * 60 * 1000);
    }
    telemetry.trackEvent('SCHEDULER_END', { schedule: 'region_hauling' });
    context.log('Region hauling scheduler completed.');
};

// HTTP-triggered function for on-demand requests (pseudo-code, add to separate function)
// module.exports = async function (context, req) {
//     const { fromRegion, toRegion } = req.body;
//     // Check if snapshot exists in repo
//     // If not, generate and save
//     // Log request
//     const combo = `${fromRegion}-${toRegion}`;
//     if (!requestLog[combo]) requestLog[combo] = [];
//     requestLog[combo].push(Date.now());
//     await sendEmailAlert(`Non-hub region hauling requested: ${combo}`, `Snapshot generated for ${combo}`);
//     context.res = { status: 200, body: 'Snapshot generated.' };
// };
