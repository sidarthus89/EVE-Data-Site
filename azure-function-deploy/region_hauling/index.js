// Region Hauling Azure Function - SQL-backed implementation
// Computes profitable routes by comparing best sell in origin region vs best buy in destination region.

const sql = require('mssql');
const telemetry = require('../utils/telemetry');
const fs = require('fs');
const path = require('path');
const { upsertDataToAll } = require('../utils/github');
const { getDbConfig } = require('../utils/db');

// Resolve DB configuration once per cold start
const dbConfig = getDbConfig();

module.exports = async function (context, req) {
  telemetry.init();
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://sidarthus89.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 200, headers: corsHeaders };
    return;
  }

  const origin_region_id = parseInt(req.query.origin_region_id || req.query.from_region, 10);
  const destination_region_id = req.query.destination_region_id || req.query.to_region
    ? parseInt(req.query.destination_region_id || req.query.to_region, 10)
    : null;
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 200;
  const forcePersist = (req.query.persist === '1' || req.query.persist === 'true');

  if (!origin_region_id) {
    context.res = {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: { error: 'origin_region_id or from_region is required' }
    };
    return;
  }

  const toRegion = destination_region_id || origin_region_id;

  // Hubs list (sync with scheduler). Allow override via env HUB_REGIONS="10000002,10000043,..."
  const HUB_REGIONS = (process.env.HUB_REGIONS ? process.env.HUB_REGIONS.split(',').map(s => Number(s.trim())) : [10000002, 10000043, 10000032, 10000030, 10000042]);
  const isHubToHub = HUB_REGIONS.includes(origin_region_id) && HUB_REGIONS.includes(toRegion);

  // Repository snapshot directory (relative to function folder)
  const SNAPSHOT_DIR = path.join(__dirname, '../../public/data/region_hauling');
  function saveSnapshotToRepo(routes) {
    const payload = JSON.stringify({ origin_region_id, destination_region_id: toRegion, count: routes.length, routes });
    try {
      if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      const fileName = path.join(SNAPSHOT_DIR, `${origin_region_id}-${toRegion}.json`);
      fs.writeFileSync(fileName, payload);
      telemetry.trackEvent('ON_DEMAND_SNAPSHOT_SAVED', {
        origin_region_id: String(origin_region_id),
        destination_region_id: String(toRegion),
        count: String(routes.length)
      });
    } catch (e) {
      telemetry.trackException(e, { area: 'fs.writeSnapshot', origin_region_id: String(origin_region_id), destination_region_id: String(toRegion) });
    }
    // Upsert to GitHub repo (always attempt)
    const repoPath = `region_hauling/${origin_region_id}-${toRegion}.json`;
    upsertDataToAll(repoPath, payload, `chore(region-hauling): update ${origin_region_id}-${toRegion}.json`)
      .then(results => telemetry.trackEvent('ON_DEMAND_SNAPSHOT_COMMITTED', { path: repoPath, targets: JSON.stringify(results) }))
      .catch(e => telemetry.trackException(e, { area: 'github.upsertFile', path: repoPath }));
  }

  // Structured trace for request
  telemetry.trackEvent('REGION_HAULING_REQUEST', {
    origin_region_id: String(origin_region_id),
    destination_region_id: String(toRegion),
    limit: String(limit),
    source: 'http'
  });

  try {
    if (!dbConfig) {
      const err = new Error("Database configuration is missing. Provide DB_CONNECTION_STRING or SQLCONNSTR_* or DB_* env vars.");
      err.code = 'CONFIG_DB_MISSING';
      throw err;
    }

    // Support both config objects and connection strings
    const pool = await sql.connect(dbConfig);

    const queryWithJoins = `
WITH types AS (
  SELECT DISTINCT type_id FROM market_orders WHERE region_id IN (@fromRegion, @toRegion)
)
SELECT TOP (@limit)
  s.type_id,
  s.location_id AS origin_id,
  ISNULL(lo.location_name, CONCAT('Station ', s.location_id)) AS origin_name,
  lo.security_status AS origin_security,
  lo.is_npc AS origin_is_npc,
  lo.system_id AS origin_system_id,
  b.location_id AS destination_id,
  ISNULL(ld.location_name, CONCAT('Station ', b.location_id)) AS destination_name,
  ld.security_status AS destination_security,
  ld.is_npc AS destination_is_npc,
  ld.system_id AS destination_system_id,
  CAST(s.price AS DECIMAL(18,2)) AS sell_price,
  CAST(b.price AS DECIMAL(18,2)) AS buy_price,
  CAST(b.price - s.price AS DECIMAL(18,4)) AS profit_per_unit,
  CAST(((b.price - s.price) / NULLIF(s.price,0)) * 100.0 AS FLOAT) AS profit_margin,
  CAST(CASE WHEN s.volume_remain < b.volume_remain THEN s.volume_remain ELSE b.volume_remain END AS INT) AS max_volume,
  CAST((b.price - s.price) * (CASE WHEN s.volume_remain < b.volume_remain THEN s.volume_remain ELSE b.volume_remain END) AS DECIMAL(18,2)) AS total_profit,
  CAST(s.price * (CASE WHEN s.volume_remain < b.volume_remain THEN s.volume_remain ELSE b.volume_remain END) AS DECIMAL(18,2)) AS total_cost
FROM types t
CROSS APPLY (
  SELECT TOP 1 o.*
  FROM market_orders o
  WHERE o.region_id = @fromRegion AND o.type_id = t.type_id AND o.is_buy_order = 0 AND o.volume_remain > 0
  ORDER BY o.price ASC
) s
CROSS APPLY (
  SELECT TOP 1 o.*
  FROM market_orders o
  WHERE o.region_id = @toRegion AND o.type_id = t.type_id AND o.is_buy_order = 1 AND o.volume_remain > 0
  ORDER BY o.price DESC
) b
LEFT JOIN locations lo ON lo.location_id = s.location_id
LEFT JOIN locations ld ON ld.location_id = b.location_id
WHERE b.price > s.price
ORDER BY profit_margin DESC, total_profit DESC;`;

    const queryNoJoins = `
WITH types AS (
  SELECT DISTINCT type_id FROM market_orders WHERE region_id IN (@fromRegion, @toRegion)
)
SELECT TOP (@limit)
  s.type_id,
  s.location_id AS origin_id,
  NULL AS origin_name,
  NULL AS origin_security,
  NULL AS origin_is_npc,
  NULL AS origin_system_id,
  b.location_id AS destination_id,
  NULL AS destination_name,
  NULL AS destination_security,
  NULL AS destination_is_npc,
  NULL AS destination_system_id,
  CAST(s.price AS DECIMAL(18,2)) AS sell_price,
  CAST(b.price AS DECIMAL(18,2)) AS buy_price,
  CAST(b.price - s.price AS DECIMAL(18,4)) AS profit_per_unit,
  CAST(((b.price - s.price) / NULLIF(s.price,0)) * 100.0 AS FLOAT) AS profit_margin,
  CAST(CASE WHEN s.volume_remain < b.volume_remain THEN s.volume_remain ELSE b.volume_remain END AS INT) AS max_volume,
  CAST((b.price - s.price) * (CASE WHEN s.volume_remain < b.volume_remain THEN s.volume_remain ELSE b.volume_remain END) AS DECIMAL(18,2)) AS total_profit,
  CAST(s.price * (CASE WHEN s.volume_remain < b.volume_remain THEN s.volume_remain ELSE b.volume_remain END) AS DECIMAL(18,2)) AS total_cost
FROM types t
CROSS APPLY (
  SELECT TOP 1 o.*
  FROM market_orders o
  WHERE o.region_id = @fromRegion AND o.type_id = t.type_id AND o.is_buy_order = 0 AND o.volume_remain > 0
  ORDER BY o.price ASC
) s
CROSS APPLY (
  SELECT TOP 1 o.*
  FROM market_orders o
  WHERE o.region_id = @toRegion AND o.type_id = t.type_id AND o.is_buy_order = 1 AND o.volume_remain > 0
  ORDER BY o.price DESC
) b
WHERE b.price > s.price
ORDER BY profit_margin DESC, total_profit DESC;`;

    let result;
    try {
      result = await pool.request()
        .input('fromRegion', sql.Int, origin_region_id)
        .input('toRegion', sql.Int, toRegion)
        .input('limit', sql.Int, limit)
        .query(queryWithJoins);
    } catch (joinErr) {
      context.log.warn('region_hauling: locations join failed, retrying without joins:', joinErr.message);
      result = await pool.request()
        .input('fromRegion', sql.Int, origin_region_id)
        .input('toRegion', sql.Int, toRegion)
        .input('limit', sql.Int, limit)
        .query(queryNoJoins);
    }

    const rows = result.recordset || [];

    const routes = rows.map(r => ({
      type_id: r.type_id,
      origin_id: Number(r.origin_id),
      origin_name: r.origin_name || null,
      origin_security: r.origin_security != null ? Number(r.origin_security) : null,
      origin_is_npc: r.origin_is_npc === true || r.origin_is_npc === 1,
      origin_system_id: r.origin_system_id != null ? Number(r.origin_system_id) : null,
      destination_id: Number(r.destination_id),
      destination_name: r.destination_name || null,
      destination_security: r.destination_security != null ? Number(r.destination_security) : null,
      destination_is_npc: r.destination_is_npc === true || r.destination_is_npc === 1,
      destination_system_id: r.destination_system_id != null ? Number(r.destination_system_id) : null,
      sell_price: Number(r.sell_price),
      buy_price: Number(r.buy_price),
      profit_per_unit: Number(r.profit_per_unit),
      profit_margin: Number(r.profit_margin),
      max_volume: r.max_volume != null ? Number(r.max_volume) : 0,
      total_profit: r.total_profit != null ? Number(r.total_profit) : undefined,
      total_cost: r.total_cost != null ? Number(r.total_cost) : undefined
    }));

    telemetry.trackEvent('REGION_HAULING_SUCCESS', {
      origin_region_id: String(origin_region_id),
      destination_region_id: String(toRegion),
      count: String(routes.length)
    });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: {
        origin_region_id,
        destination_region_id: toRegion,
        routes,
        count: routes.length
      }
    };

    // Persist snapshot when non-hub-to-hub, or when forced via query flag
    if ((forcePersist || !isHubToHub) && routes.length > 0) {
      // Fire-and-forget; do not block response
      setImmediate(() => saveSnapshotToRepo(routes));
    }
  } catch (error) {
    // Capture rich diagnostics to distinguish auth vs. network vs. SQL issues
    const errProps = {
      area: 'region_hauling',
      origin_region_id: String(origin_region_id),
      destination_region_id: String(toRegion),
      code: error && (error.code || error.name) || undefined,
      number: error && (error.number || error.errno) || undefined,
      original: error && error.originalError && error.originalError.message || undefined
    };
    context.log.error('region_hauling SQL error:', errProps, error && error.message);
    telemetry.trackException(error, errProps);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: {
        error: error && error.message || 'Internal error',
        code: errProps.code,
        number: errProps.number,
        origin_region_id,
        destination_region_id: toRegion,
        routes: [],
        count: 0
      }
    };
  }
};
