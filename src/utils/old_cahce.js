// cache.js 

const marketCache = {};

export async function fetchMarketOrdersCached(typeID, regionID) {
    const key = `${typeID}-${regionID}`;
    if (marketCache[key]) {
        return marketCache[key];
    }

    const result = await fetchMarketOrders(typeID, regionID);
    marketCache[key] = result;
    return result;
}
