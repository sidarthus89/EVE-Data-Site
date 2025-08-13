// src/utils/dataManager.js

class DataManager {
    constructor() {
        this.cache = new Map();
        this.locations = null;
        this.market = null;
        this.processedLocations = null;
        this.loadPromises = new Map();

        this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        this.LOCATIONS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    }

    async loadStaticData() {
        if (this.locations && this.market) {
            return { locations: this.locations, market: this.market };
        }
        if (this.loadPromises.has('static')) {
            return this.loadPromises.get('static');
        }
        const loadPromise = this._loadStaticDataInternal();
        this.loadPromises.set('static', loadPromise);
        try {
            const result = await loadPromise;
            this.loadPromises.delete('static');
            return result;
        } catch (error) {
            this.loadPromises.delete('static');
            throw error;
        }
    }

    async _loadStaticDataInternal() {
        try {
            // Fetch JSON from public folder at runtime
            const [locationsResp, marketResp] = await Promise.all([
                fetch('/data/locations.json'),
                fetch('/data/market.json'),
            ]);
            if (!locationsResp.ok) throw new Error('Failed to load locations.json');
            if (!marketResp.ok) throw new Error('Failed to load market.json');

            this.locations = await locationsResp.json();
            this.market = await marketResp.json();

            this.processedLocations = this._preprocessLocations(this.locations);

            return { locations: this.locations, market: this.market };
        } catch (error) {
            console.error('Error loading static data:', error);
            throw error;
        }
    }

    _preprocessLocations(locations) {
        const npcStationIDs = new Set();
        const stationLookup = {};
        const regionLookup = {};
        const systemLookup = {};

        const processRegion = (regionKey, region) => {
            if (region.regionID) {
                regionLookup[region.regionID] = {
                    key: regionKey,
                    name: region.regionName || regionKey,
                    ...region,
                };
            }

            // Format A: region.constellations[constellation].systems[system]
            if (region.constellations) {
                Object.entries(region.constellations).forEach(([constellationKey, constellation]) => {
                    if (typeof constellation !== 'object' || !constellation.systems) return;
                    Object.entries(constellation.systems).forEach(([systemKey, system]) => {
                        if (typeof system !== 'object') return;
                        if (system.systemID) {
                            systemLookup[system.systemID] = {
                                key: systemKey,
                                regionKey,
                                ...system,
                            };
                        }
                        if (system.stations) {
                            Object.entries(system.stations).forEach(([stationID, station]) => {
                                const id = Number(stationID);
                                npcStationIDs.add(id);
                                stationLookup[id] = {
                                    name: station.stationName || station.name || 'Unknown Station',
                                    security: station.security ?? system.security ?? null,
                                    systemName: system.systemName || systemKey,
                                    regionName: region.regionName || regionKey,
                                    regionKey,
                                    systemKey,
                                    ...station,
                                };
                            });
                        }
                    });
                });
                return;
            }

            // Format B: region[constellation][system]
            Object.entries(region).forEach(([constellationKey, constellation]) => {
                if (constellationKey === 'regionID' || typeof constellation !== 'object') return;
                Object.entries(constellation).forEach(([systemKey, system]) => {
                    if (systemKey === 'constellationID' || typeof system !== 'object') return;
                    if (system.solarSystemID) {
                        systemLookup[system.solarSystemID] = {
                            key: systemKey,
                            regionKey,
                            ...system,
                        };
                    }
                    if (system.stations) {
                        Object.entries(system.stations).forEach(([stationID, station]) => {
                            const id = Number(stationID);
                            npcStationIDs.add(id);
                            stationLookup[id] = {
                                name: station.stationName || station.name || 'Unknown Station',
                                security: station.security ?? system.security ?? null,
                                systemName: system.solarSystemName || systemKey,
                                regionName: region.regionName || regionKey,
                                regionKey,
                                systemKey,
                                ...station,
                            };
                        });
                    }
                });
            });
        };

        Object.entries(locations).forEach(([regionKey, region]) => {
            if (typeof region === 'object') {
                processRegion(regionKey, region);
            }
        });

        return { npcStationIDs, stationLookup, regionLookup, systemLookup };
    }

    async getProcessedLocations() {
        if (!this.processedLocations) {
            await this.loadStaticData();
        }
        return this.processedLocations;
    }

    async getMarketStructure() {
        if (!this.market) {
            await this.loadStaticData();
        }
        return this.market;
    }

    _getCacheKey(url, params = {}) {
        const paramString = Object.keys(params).length
            ? '?' + new URLSearchParams(params).toString()
            : '';
        return url + paramString;
    }

    _isCacheValid(item, ttl = this.CACHE_TTL) {
        return Date.now() - item.timestamp < ttl;
    }

    async fetchWithCache(url, params = {}, ttl = this.CACHE_TTL) {
        const cacheKey = this._getCacheKey(url, params);
        const cached = this.cache.get(cacheKey);
        if (cached && this._isCacheValid(cached, ttl)) {
            return cached.data;
        }
        const fullUrl = Object.keys(params).length
            ? `${url}?${new URLSearchParams(params).toString()}`
            : url;
        const response = await fetch(fullUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        const totalPages = parseInt(response.headers.get('X-Pages') || '1', 10);
        this.cache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            totalPages,
        });
        return data;
    }

    async fetchAllMarketPages(baseUrl, typeID, regionID) {
        const cacheKey = this._getCacheKey(baseUrl + regionID + '/orders/', { type_id: typeID });
        const cached = this.cache.get(cacheKey);
        if (cached && this._isCacheValid(cached)) {
            return cached.data;
        }
        const firstPageUrl = `${baseUrl}${regionID}/orders/`;
        const firstPageParams = { type_id: typeID, page: 1 };
        const firstPageData = await this.fetchWithCache(firstPageUrl, firstPageParams);
        const firstPageCacheKey = this._getCacheKey(firstPageUrl, firstPageParams);
        const firstPageCache = this.cache.get(firstPageCacheKey);
        const totalPages = firstPageCache?.totalPages || 1;
        if (totalPages === 1) {
            this.cache.set(cacheKey, { data: firstPageData, timestamp: Date.now() });
            return firstPageData;
        }
        const promises = [];
        for (let page = 2; page <= totalPages; page++) {
            promises.push(this.fetchWithCache(firstPageUrl, { type_id: typeID, page }));
        }
        const remainingPages = await Promise.allSettled(promises);
        const combinedOrders = [
            ...firstPageData,
            ...remainingPages.filter(r => r.status === 'fulfilled').flatMap(r => r.value),
        ];
        this.cache.set(cacheKey, { data: combinedOrders, timestamp: Date.now() });
        return combinedOrders;
    }

    cleanCache() {
        for (const [key, value] of this.cache.entries()) {
            if (!this._isCacheValid(value)) {
                this.cache.delete(key);
            }
        }
    }

    getCacheStats() {
        const total = this.cache.size;
        const valid = Array.from(this.cache.values()).filter((item) =>
            this._isCacheValid(item)
        ).length;
        return {
            total,
            valid,
            expired: total - valid,
            memoryUsage: JSON.stringify([...this.cache.entries()]).length,
        };
    }

    clearCache(pattern) {
        if (!pattern) {
            this.cache.clear();
            return;
        }
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) this.cache.delete(key);
        }
    }

    async preloadCommonData(typeIDs = [], regionIDs = []) {
        await this.loadStaticData();
        const promises = [];
        for (const typeID of typeIDs) {
            for (const regionID of regionIDs) {
                promises.push(
                    this.fetchAllMarketPages(
                        'https://esi.evetech.net/latest/markets/',
                        typeID,
                        regionID
                    ).catch((err) => {
                        console.warn(`Failed to preload ${typeID} in region ${regionID}`, err);
                    })
                );
            }
        }
        await Promise.allSettled(promises);
    }
}

export async function filterOrdersByNpcStations(orders) {
    const { npcStationIDs } = await dataManager.getProcessedLocations();
    const filteredSellers = orders.filter(
        (o) => !o.is_buy_order && npcStationIDs.has(o.location_id)
    );
    const filteredBuyers = orders.filter(
        (o) => o.is_buy_order && npcStationIDs.has(o.location_id)
    );
    return { filteredSellers, filteredBuyers };
}

export const dataManager = new DataManager();

export const getRegionID = async (regionRef) => {
    if (!regionRef) return null;
    const { regionLookup } = await dataManager.getProcessedLocations();
    if (!isNaN(regionRef)) {
        const idNum = Number(regionRef);
        if (regionLookup[idNum]) return idNum;
    }
    const refLower = String(regionRef).toLowerCase();
    const byKey = Object.values(regionLookup).find(
        (r) => String(r.key).toLowerCase() === refLower
    );
    if (byKey) return byKey.regionID;
    const byName = Object.values(regionLookup).find(
        (r) => String(r.regionName).toLowerCase() === refLower
    );
    if (byName) return byName.regionID;
    console.warn(`⚠️ getRegionID: Could not resolve regionRef "${regionRef}"`);
    return null;
};

export const getStationInfo = async (stationID) => {
    const { stationLookup } = await dataManager.getProcessedLocations();
    return stationLookup[stationID] || { name: 'Unknown Station', security: null };
};

export const getNPCStationIDs = async () => {
    const { npcStationIDs } = await dataManager.getProcessedLocations();
    return npcStationIDs;
};

setInterval(() => dataManager.cleanCache(), 5 * 60 * 1000);

export default dataManager;
