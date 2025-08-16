var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// utils/locations.js
function getStationName(stationID) {
  return locations[stationID]?.name ?? "Unknown Station";
}
__name(getStationName, "getStationName");
function getSecurityLevel(stationID) {
  return locations[stationID]?.security ?? 0;
}
__name(getSecurityLevel, "getSecurityLevel");
function getRegionName(regionID) {
  const idNum = Number(regionID);
  for (const loc of Object.values(locations)) {
    if (loc.regionID === idNum) {
      return loc.regionName;
    }
  }
  return "Unknown Region";
}
__name(getRegionName, "getRegionName");

// utils/fetchers.js
async function fetchMarketHistory(itemId, regionId, env2) {
  const key = `history:${regionId}:${itemId}`;
  const raw = await env2.MARKET_HISTORY.get(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`\u26A0\uFE0F Failed to parse history for ${regionId}:${itemId}`, e);
    return [];
  }
}
__name(fetchMarketHistory, "fetchMarketHistory");
async function fetchMarketOrdersFromBackend(regionID) {
  const esiUrl = `https://esi.evetech.net/latest/markets/${regionID}/orders/?order_type=all`;
  const response = await fetch(esiUrl);
  if (!response.ok) throw new Error("ESI fetch failed");
  return await response.json();
}
__name(fetchMarketOrdersFromBackend, "fetchMarketOrdersFromBackend");

// handlers/market-orders.js
async function handleMarketOrders(url, env2) {
  const region = url.searchParams.get("region");
  if (!region) return new Response("Missing region", { status: 400 });
  const cacheKey = `orders:${region}`;
  const cached = await env2.MARKET_ORDERS?.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
    });
  }
  const rawOrders = await fetchMarketOrdersFromBackend(region);
  const enriched = rawOrders.map((order) => ({
    ...order,
    security: getSecurityLevel(order.stationID),
    station: getStationName(order.stationID),
    region
  }));
  const json = JSON.stringify(enriched);
  await env2.MARKET_ORDERS?.put(cacheKey, json, { expirationTtl: 600 });
  return new Response(json, {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
  });
}
__name(handleMarketOrders, "handleMarketOrders");

// handlers/price-history.js
async function handlePriceHistory(url) {
  const itemId = url.searchParams.get("itemId");
  const regions = url.searchParams.getAll("region");
  if (!itemId || regions.length === 0) {
    return new Response("Missing itemId or region", { status: 400 });
  }
  const allHistory = await Promise.all(
    regions.map(async (regionId) => {
      const history = await fetchMarketHistory(itemId, regionId, env);
      return history.map((entry) => ({
        date: entry.date,
        average: entry.average,
        totalVolume: entry.volume,
        region: getRegionName(regionId)
      }));
    })
  );
  const aggregated = {};
  allHistory.flat().forEach((entry) => {
    const key = entry.date;
    if (!aggregated[key]) {
      aggregated[key] = { date: key, averageSum: 0, volumeSum: 0, count: 0 };
    }
    aggregated[key].averageSum += entry.average;
    aggregated[key].volumeSum += entry.totalVolume;
    aggregated[key].count += 1;
  });
  const result = Object.values(aggregated).map((entry) => ({
    date: entry.date,
    average: Math.round(entry.averageSum / entry.count),
    totalVolume: entry.volumeSum
  }));
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
  });
}
__name(handlePriceHistory, "handlePriceHistory");

// handlers/market-distribution.js
async function handleMarketDistribution(url, env2) {
  const allOrdersRaw = await env2.MARKET_ORDERS.get("orders:all");
  if (!allOrdersRaw) {
    return new Response("No cached orders", { status: 404 });
  }
  const orders = JSON.parse(allOrdersRaw);
  const prices = orders.map((o) => o.price).filter((p) => p > 0).sort((a, b) => a - b);
  const p1 = prices[Math.floor(prices.length * 0.01)];
  const p99 = prices[Math.floor(prices.length * 0.99)];
  const filtered = orders.filter(
    (o) => o.price >= p1 && o.price <= p99 && o.volume_remain > 0
  );
  const map = {};
  filtered.forEach((order) => {
    const region = getRegionName(order.regionID);
    if (!map[region]) {
      map[region] = { region, buyerVolume: 0, sellerVolume: 0 };
    }
    if (order.is_buy_order) {
      map[region].buyerVolume += order.volume_remain;
    } else {
      map[region].sellerVolume += order.volume_remain;
    }
  });
  const result = Object.values(map);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
  });
}
__name(handleMarketDistribution, "handleMarketDistribution");

// utils/proxy.js
async function proxyToESI(url) {
  const esiUrl = `https://esi.evetech.net/latest${url.pathname}?${url.searchParams.toString()}`;
  try {
    const esiResponse = await fetch(esiUrl);
    const body = await esiResponse.text();
    const headers = new Headers(esiResponse.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET");
    headers.set("Content-Type", "application/json");
    return new Response(body, {
      status: esiResponse.status,
      headers
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "ESI fetch failed", detail: err.message }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
__name(proxyToESI, "proxyToESI");

// handlers/trade-route.js
async function fetchMarketOrders(typeID, regionID) {
  const allOrders = await fetchMarketOrdersFromBackend(regionID);
  const buyOrders = allOrders.filter((o) => o.type_id == typeID && o.is_buy_order);
  const sellOrders = allOrders.filter((o) => o.type_id == typeID && !o.is_buy_order);
  return { buyOrders, sellOrders };
}
__name(fetchMarketOrders, "fetchMarketOrders");
async function handleTradeRoute(request, env2) {
  try {
    const url = new URL(request.url);
    const startRegionID = Number(url.searchParams.get("startRegionID"));
    const endRegionID = Number(url.searchParams.get("endRegionID"));
    const tradeMode = url.searchParams.get("tradeMode") || "buyToSell";
    const profitAbove = Number(url.searchParams.get("profitAbove")) || 5e5;
    const roiMin = Number(url.searchParams.get("roi")) || 0;
    const budget = Number(url.searchParams.get("budget")) || Infinity;
    const capacity = Number(url.searchParams.get("capacity")) || Infinity;
    const salesTax = Number(url.searchParams.get("salesTax")) || 7.5;
    const maxJumps = Number(url.searchParams.get("maxJumps")) || Infinity;
    if (!startRegionID || !endRegionID) {
      return new Response(JSON.stringify({ error: "Missing start or end region IDs" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
    const typeIDsToCheck = [34, 35, 36];
    const routes = [];
    for (const typeID of typeIDsToCheck) {
      const startOrders = await fetchMarketOrders(typeID, startRegionID);
      const endOrders = await fetchMarketOrders(typeID, endRegionID);
      const cheapestSell = startOrders.sellOrders.sort((a, b) => a.price - b.price)[0];
      const highestBuy = endOrders.buyOrders.sort((a, b) => b.price - a.price)[0];
      if (cheapestSell && highestBuy) {
        const profit = highestBuy.price - cheapestSell.price;
        const roi = profit / cheapestSell.price * 100;
        if (profit >= profitAbove && roi >= roiMin) {
          routes.push({
            itemId: typeID,
            itemName: `Item ${typeID}`,
            // TODO: replace with actual item name lookup
            from: startRegionID,
            to: endRegionID,
            buyPrice: cheapestSell.price,
            sellPrice: highestBuy.price,
            netProfit: profit,
            roi,
            quantity: Math.min(cheapestSell.volume_remain, capacity),
            jumps: Math.floor(Math.random() * 10) + 1,
            // Placeholder
            profitPerJump: profit / Math.max(1, Math.floor(Math.random() * 10) + 1),
            profitPerItem: profit,
            totalVolume: cheapestSell.volume_remain
          });
        }
      }
    }
    routes.sort((a, b) => b.netProfit - a.netProfit);
    return new Response(JSON.stringify(routes), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}
__name(handleTradeRoute, "handleTradeRoute");

// handlers/kv.js
var JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};
function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
__name(safeParse, "safeParse");
function jsonResponse(data, status = 200) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  return new Response(body, {
    status,
    headers: JSON_HEADERS
  });
}
__name(jsonResponse, "jsonResponse");
async function handleKVFetch(env2, namespace, key, label) {
  const raw = await env2[namespace]?.get(key);
  console.log(`[KV] ${label} raw preview:`, raw?.slice(0, 200));
  if (!raw || raw.trim() === "") {
    console.warn(`[KV] ${label} missing or empty`);
    return jsonResponse({ error: `${label} not found or empty in KV` }, 500);
  }
  const parsed = safeParse(raw);
  if (!parsed) {
    console.warn(`[KV] ${label} contains invalid JSON`);
    return jsonResponse({ error: `Invalid JSON in ${label}`, detail: raw }, 500);
  }
  return jsonResponse(parsed);
}
__name(handleKVFetch, "handleKVFetch");
async function handleMarketTree(request, env2) {
  return handleKVFetch(env2, "MARKET_TREE", "market:tree", "market:tree");
}
__name(handleMarketTree, "handleMarketTree");
async function handleLocations(request, env2) {
  try {
    const raw = await env2.LOCATIONS.get("locations:all");
    if (!raw) throw new Error("KV 'locations:all' is empty");
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    console.error("\u274C handleLocations failed:", err);
    return new Response(`Internal error: ${err.message}`, { status: 500 });
  }
}
__name(handleLocations, "handleLocations");

// handlers/debug.js
async function onRequest({ request, env: env2 }) {
  const url = new URL(request.url);
  if (url.pathname === "/api/debug/market-tree") {
    return handleDebugKV(env2.MARKET_TREE, "market:tree");
  }
  if (url.pathname === "/api/debug/locations") {
    return handleDebugKV(env2.LOCATIONS, "locations:all");
  }
  if (url.pathname === "/api/debug/clean-kv") {
    return handleCleanKV(env2);
  }
  return new Response("Unknown debug route", { status: 404 });
}
__name(onRequest, "onRequest");
async function handleDebugKV(env2, key) {
  const raw = await env2.get(key);
  return new Response(`${key}:
${raw}`, {
    headers: { "Content-Type": "text/plain" }
  });
}
__name(handleDebugKV, "handleDebugKV");
async function handleCleanKV(env2) {
  const marketRaw = await env2.MARKET_TREE.get("market:tree");
  const locationRaw = await env2.LOCATIONS.get("locations:all");
  let marketParsed, locationParsed;
  let messages = [];
  try {
    marketParsed = JSON.parse(marketRaw);
    await env2.MARKET_TREE.put("market:tree", JSON.stringify(marketParsed));
    messages.push("\u2705 market:tree cleaned");
  } catch (err) {
    messages.push(`\u274C market:tree invalid JSON:
${marketRaw}`);
  }
  try {
    locationParsed = JSON.parse(locationRaw);
    await env2.LOCATIONS.put("locations:all", JSON.stringify(locationParsed));
    messages.push("\u2705 locations:all cleaned");
  } catch (err) {
    messages.push(`\u274C locations:all invalid JSON:
${locationRaw}`);
  }
  return new Response(messages.join("\n\n"), {
    headers: { "Content-Type": "text/plain" }
  });
}
__name(handleCleanKV, "handleCleanKV");

// index.js
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  // adjust to your domain if needed
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function withCORS(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, headers });
}
__name(withCORS, "withCORS");
var index_default = {
  async fetch(request, env2) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "");
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const IS_DEV = env2.IS_DEV === "true";
    const WORKER_ESI_BASE = IS_DEV ? "http://localhost:8787/markets/" : "https://eve-data-api.sidarthus89.workers.dev/markets/";
    const WORKER_KV_BASE = IS_DEV ? "http://localhost:8787/api/" : "https://eve-data-api.sidarthus89.workers.dev/api/";
    if (pathname.match(/^\/markets\/\d+\/history\/$/)) {
      const regionID = pathname.split("/")[2];
      const typeID = url.searchParams.get("type_id");
      if (!regionID || !typeID) {
        return withCORS(new Response("Missing regionID or typeID", { status: 400 }));
      }
      url.searchParams.set("itemId", typeID);
      url.searchParams.delete("type_id");
      url.searchParams.set("region", regionID);
      try {
        const res = await handlePriceHistory(url, env2);
        return withCORS(res);
      } catch (err) {
        return withCORS(new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }));
      }
    }
    if (pathname.startsWith("/markets/")) {
      try {
        const res = await proxyToESI(url);
        return withCORS(res);
      } catch (err) {
        return withCORS(new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }));
      }
    }
    const routeMap = {
      "/market-orders": /* @__PURE__ */ __name(() => handleMarketOrders(url, env2), "/market-orders"),
      "/price-history": /* @__PURE__ */ __name(() => handlePriceHistory(url, env2), "/price-history"),
      "/market-distribution": /* @__PURE__ */ __name(() => handleMarketDistribution(url, env2), "/market-distribution"),
      "/api/market-tree": /* @__PURE__ */ __name(() => handleMarketTree(request, env2), "/api/market-tree"),
      "/api/locations": /* @__PURE__ */ __name(() => handleLocations(request, env2), "/api/locations"),
      "/api/trade-route": /* @__PURE__ */ __name(() => handleTradeRoute(request, env2), "/api/trade-route"),
      "/api/debug/kv": /* @__PURE__ */ __name(() => handleDebugKV2(env2), "/api/debug/kv"),
      "/api/debug/market-tree": /* @__PURE__ */ __name(() => onRequest({ request, env: env2 }), "/api/debug/market-tree"),
      "/api/debug/locations": /* @__PURE__ */ __name(() => onRequest({ request, env: env2 }), "/api/debug/locations"),
      "/api/debug/clean-kv": /* @__PURE__ */ __name(() => handleCleanKV2(env2), "/api/debug/clean-kv"),
      "/api/seed": /* @__PURE__ */ __name(() => request.method === "POST" ? seedKV(env2) : new Response("Method Not Allowed", { status: 405 }), "/api/seed")
    };
    if (routeMap[pathname]) {
      try {
        const res = await routeMap[pathname]();
        return withCORS(res);
      } catch (err) {
        return withCORS(new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }));
      }
    }
    return withCORS(new Response("Not found", { status: 404 }));
  }
};
async function handleDebugKV2(env2) {
  const marketRaw = await env2.MARKET_TREE.get("market:tree");
  const locationRaw = await env2.LOCATIONS.get("locations:all");
  let marketTree = [];
  let locations2 = [];
  try {
    marketTree = JSON.parse(marketRaw || "[]");
  } catch {
  }
  try {
    locations2 = JSON.parse(locationRaw || "[]");
  } catch {
  }
  return new Response(JSON.stringify({
    marketTreePreview: Array.isArray(marketTree) ? marketTree.slice(0, 500) : [],
    locationsPreview: Array.isArray(locations2) ? locations2.slice(0, 500) : [],
    marketTreeType: typeof marketTree,
    locationsType: typeof locations2
  }, null, 2), { headers: { "Content-Type": "application/json" } });
}
__name(handleDebugKV2, "handleDebugKV");
async function handleCleanKV2(env2) {
  const messages = [];
  const marketRaw = await env2.MARKET_TREE.get("market:tree");
  const locationRaw = await env2.LOCATIONS.get("locations:all");
  try {
    const parsedMarket = JSON.parse(marketRaw);
    await env2.MARKET_TREE.put("market:tree", JSON.stringify(parsedMarket));
    messages.push("\u2705 market:tree cleaned");
  } catch (err) {
    messages.push(`\u274C market:tree invalid JSON`);
  }
  try {
    const parsedLocations = JSON.parse(locationRaw);
    await env2.LOCATIONS.put("locations:all", JSON.stringify(parsedLocations));
    messages.push("\u2705 locations:all cleaned");
  } catch (err) {
    messages.push(`\u274C locations:all invalid JSON`);
  }
  return new Response(messages.join("\n\n"), { headers: { "Content-Type": "text/plain" } });
}
__name(handleCleanKV2, "handleCleanKV");
async function seedKV(env2) {
  try {
    await env2.MARKET_TREE.put("market:tree", JSON.stringify(marketData));
    await env2.LOCATIONS.put("locations:all", JSON.stringify(locationsData));
    return new Response(JSON.stringify({ message: "KV seeded successfully" }, null, 2), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
__name(seedKV, "seedKV");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-aAcPij/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = index_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-aAcPij/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
