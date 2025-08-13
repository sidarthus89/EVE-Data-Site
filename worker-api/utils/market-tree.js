// worker-api/utils/market-tree.js

let typeMeta = null;
let marketTree = null;

export async function loadMarketData(env) {
    if (marketTree && typeMeta) return;

    const raw = await env.MARKET_TREE.get("market:tree");
    const parsed = JSON.parse(raw);

    marketTree = parsed;
    typeMeta = new Map();

    for (const categoryName in marketTree) {
        const category = marketTree[categoryName];
        for (const groupName in category) {
            if (groupName === '_info' || groupName === 'items') continue;
            const group = category[groupName];
            const items = group.items || [];

            for (const item of items) {
                typeMeta.set(item.typeID, {
                    typeName: item.typeName,
                    groupName,
                    categoryName,
                    iconFile: item.iconFile,
                    volume: item.volume,
                    mass: item.mass,
                    groupID: group._info?.marketGroupID,
                    categoryID: group._info?.categoryID ?? null
                });
            }
        }
    }
}

export async function getTypeMeta(env, typeID) {
    await loadMarketData(env);
    return typeMeta.get(String(typeID)) ?? null;
}

export async function getMarketPath(env, itemID) {
    await loadMarketData(env);
    return marketTree[itemID]?.path ?? ["Unknown"];
}

export async function getGroupName(env, groupID) {
    await loadMarketData(env);
    return marketTree[groupID]?.groupName ?? "Unknown Group";
}