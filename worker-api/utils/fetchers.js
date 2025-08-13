// worker-api/utils/fetchers.js

export async function fetchMarketHistory(itemId, regionId) {
    const esiUrl = `https://esi.evetech.net/latest/markets/${regionId}/history/?type_id=${itemId}`;
    const response = await fetch(esiUrl);
    if (!response.ok) throw new Error("ESI history fetch failed");
    return await response.json();
}

export async function fetchMarketOrdersFromBackend(regionID) {
    const esiUrl = `https://esi.evetech.net/latest/markets/${regionID}/orders/?order_type=all`;
    const response = await fetch(esiUrl);
    if (!response.ok) throw new Error("ESI fetch failed");
    return await response.json();
}
