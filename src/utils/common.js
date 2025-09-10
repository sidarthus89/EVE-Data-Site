// src/utils/common.js
export const truncateToOneDecimal = num => Math.floor(num * 10) / 10;

export const capitalizeWords = str =>
    str?.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') ?? '';

export const formatISK = val =>
    `${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK`;

export const formatExpiresIn = mins => {
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return `${d}d ${h}h ${m}m`;
};

export const formatRange = range => {
    const r = parseInt(range, 10);
    if (r === -1) return 'Station';
    if (r === 0) return 'System';
    if (r === 32767) return 'Region';
    if (!isNaN(r)) return `${r} ${r === 1 ? 'Jump' : 'Jumps'}`;
    const norm = String(range).trim().toLowerCase();
    return ['station', 'system', 'region'].includes(norm) ? capitalizeWords(norm) : capitalizeWords(range);
};

export const getSecurityColor = sec => {
    if (sec === undefined || sec === null || isNaN(sec)) return '#8f2f69';
    // Round to nearest tenth (0.86 -> 0.9) per updated requirement.
    // Clamp below 0 to 0.0 and above 1 to 1.0.
    let bucket = Math.round(sec * 10) / 10;
    if (bucket < 0) bucket = 0.0;
    if (bucket > 1) bucket = 1.0;
    const colorMap = {
        1.0: '#2e74df',
        0.9: '#389cf6',
        0.8: '#4acff3',
        0.7: '#62daa6',
        0.6: '#71e452',
        0.5: '#eeff83',
        0.4: '#de6a0c',
        0.3: '#ce4611',
        0.2: '#bb1014',
        0.1: '#6d221d',
        0.0: '#8f2f69'
    };
    return colorMap[bucket] ?? '#8f2f69';
};

export const FILTER_OPTIONS = {
    NONE: 'none',
    MILD: 'mild',      // 5th to 95th percentile (1.5 IQR)
    MODERATE: 'moderate', // 10th to 90th percentile (1.0 IQR)
    STRICT: 'strict',   // 25th to 75th percentile (0.5 IQR)
    ULTRA: 'ultra'   // 37.5th to 62.5th percentile (0.25 IQR)
};

export function applyOutlierFilter(orders, filterType = FILTER_OPTIONS.NONE) {
    // Always allow filtering even for small sets; require at least 4 points to compute IQR meaningfully
    if (filterType === FILTER_OPTIONS.NONE || orders.length < 4) return orders;

    const sorted = [...orders].sort((a, b) => a.price - b.price);

    let lowerPercentile, upperPercentile, iqrMultiplier;

    switch (filterType) {
        case FILTER_OPTIONS.MILD:
            lowerPercentile = 0.05;
            upperPercentile = 0.95;
            iqrMultiplier = 1.5;
            break;
        case FILTER_OPTIONS.MODERATE:
            lowerPercentile = 0.10;
            upperPercentile = 0.90;
            iqrMultiplier = 1.0;
            break;
        case FILTER_OPTIONS.STRICT:
            lowerPercentile = 0.25;
            upperPercentile = 0.75;
            iqrMultiplier = 0.5;
            break;
        case FILTER_OPTIONS.ULTRA:
            lowerPercentile = 0.375;
            upperPercentile = 0.625;
            iqrMultiplier = 0.25;
            break;
        default:
            return orders;
    }

    const q1Index = Math.floor(sorted.length * lowerPercentile);
    const q3Index = Math.floor(sorted.length * upperPercentile);

    const q1 = sorted[q1Index].price;
    const q3 = sorted[q3Index].price;
    const iqr = q3 - q1;

    const lowerBound = Math.max(q1, q1 - iqrMultiplier * iqr);
    const upperBound = q3 + iqrMultiplier * iqr;

    return sorted.filter(order => order.price >= lowerBound && order.price <= upperBound);
}

export function computeVolumeWeightedAverage(orders) {
    if (!orders || orders.length === 0) return 0;
    const totalVolume = orders.reduce((sum, o) => sum + o.volume_remain, 0);
    const weightedSum = orders.reduce((sum, o) => sum + o.price * o.volume_remain, 0);
    return totalVolume > 0 ? weightedSum / totalVolume : 0;
}

// Location mapping utilities
export function buildlocationInfoMap(locationsData) {
    if (!locationsData) return {};

    const stationInfo = {};

    Object.entries(locationsData).forEach(([regionName, regionData]) => {
        if (!regionData || typeof regionData !== 'object') return;

        Object.entries(regionData).forEach(([key, value]) => {
            if (key === 'regionID' || !value || typeof value !== 'object') return;

            // This is a constellation
            Object.entries(value).forEach(([sysKey, sysValue]) => {
                if (sysKey === 'constellationID' || !sysValue || typeof sysValue !== 'object') return;

                // This is a system
                const security = sysValue.security;
                const stations = sysValue.stations;

                if (stations && typeof stations === 'object') {
                    Object.entries(stations).forEach(([stationId, stationData]) => {
                        stationInfo[stationId] = {
                            ...stationData,
                            systemName: sysKey,
                            regionName: regionName,
                            regionID: regionData.regionID,
                            solarSystemID: sysValue.solarSystemID,
                            security: security
                        };
                    });
                }
            });
        });
    });

    return stationInfo;
}

export function buildLocationIDToRegion(locationsData) {
    if (!locationsData) return {};

    const locationToRegion = {};

    Object.entries(locationsData).forEach(([regionName, regionData]) => {
        if (!regionData || typeof regionData !== 'object') return;

        Object.entries(regionData).forEach(([key, value]) => {
            if (key === 'regionID' || !value || typeof value !== 'object') return;

            // This is a constellation
            Object.entries(value).forEach(([sysKey, sysValue]) => {
                if (sysKey === 'constellationID' || !sysValue || typeof sysValue !== 'object') return;

                // This is a system
                // Map the system itself
                if (sysValue.solarSystemID) {
                    locationToRegion[sysValue.solarSystemID] = regionName;
                }

                // Map all stations in this system
                const stations = sysValue.stations;
                if (stations && typeof stations === 'object') {
                    Object.keys(stations).forEach(stationId => {
                        locationToRegion[stationId] = regionName;
                    });
                }
            });
        });
    });

    return locationToRegion;
}

// ================================
// UNIFIED STATION/REGION UTILITIES
// ================================

/**
 * Get region information by region ID or name
 */
export function getRegionInfo(regionRef, locationsData) {
    if (!regionRef || !locationsData) return null;

    // If it's a number, find by regionID
    if (!isNaN(regionRef)) {
        const regionID = Number(regionRef);
        for (const [regionName, regionData] of Object.entries(locationsData)) {
            if (regionData?.regionID === regionID) {
                return { regionID, regionName, data: regionData };
            }
        }
        return null;
    }

    // If it's a string, find by name
    const regionData = locationsData[regionRef];
    if (regionData?.regionID) {
        return { regionID: regionData.regionID, regionName: regionRef, data: regionData };
    }

    return null;
}

/**
 * Get station information by station ID
 */
export function getStationInfo(stationId, locationsData) {
    if (!stationId || !locationsData) return null;

    for (const [regionName, regionData] of Object.entries(locationsData)) {
        if (!regionData || typeof regionData !== 'object') continue;

        for (const [constKey, constData] of Object.entries(regionData)) {
            if (constKey === 'regionID' || !constData || typeof constData !== 'object') continue;

            for (const [sysKey, sysData] of Object.entries(constData)) {
                if (sysKey === 'constellationID' || !sysData || typeof sysData !== 'object') continue;

                const stations = sysData.stations;
                if (stations && stations[stationId]) {
                    return {
                        stationId,
                        locationName: stations[stationId].locationName,
                        systemName: sysData.solarSystemName,
                        systemId: sysData.solarSystemID,
                        security: sysData.security,
                        regionName,
                        regionId: regionData.regionID,
                        constellationName: constData.constellationName
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Get system information by system ID
 */
export function getSystemInfo(systemId, locationsData) {
    if (!systemId || !locationsData) return null;

    for (const [regionName, regionData] of Object.entries(locationsData)) {
        if (!regionData || typeof regionData !== 'object') continue;

        for (const [constKey, constData] of Object.entries(regionData)) {
            if (constKey === 'regionID' || !constData || typeof constData !== 'object') continue;

            for (const [sysKey, sysData] of Object.entries(constData)) {
                if (sysKey === 'constellationID' || !sysData || typeof sysData !== 'object') continue;

                if (sysData.solarSystemID === systemId) {
                    return {
                        systemId,
                        systemName: sysData.solarSystemName,
                        security: sysData.security,
                        regionName,
                        regionId: regionData.regionID,
                        constellationName: constData.constellationName,
                        stations: sysData.stations || {}
                    };
                }
            }
        }
    }

    return null;
}

/**
 * Filter regions by security status
 */
export function filterRegionsBySecurity(locationsData, securityFilter) {
    if (!locationsData || securityFilter === 'Any Security') return locationsData;

    const filtered = {};

    Object.entries(locationsData).forEach(([regionName, regionData]) => {
        if (!regionData || typeof regionData !== 'object') return;

        let hasMatchingSystems = false;
        const filteredRegion = { ...regionData };

        Object.entries(regionData).forEach(([constKey, constData]) => {
            if (constKey === 'regionID' || !constData || typeof constData !== 'object') return;

            const filteredConstellation = { ...constData };

            Object.entries(constData).forEach(([sysKey, sysData]) => {
                if (sysKey === 'constellationID' || !sysData || typeof sysData !== 'object') return;

                const security = sysData.security;
                let includeSystem = false;

                switch (securityFilter) {
                    case 'High Sec Only':
                        includeSystem = security >= 0.5;
                        break;
                    case 'Low Sec':
                        includeSystem = security > 0.0 && security < 0.5;
                        break;
                    case 'Null Sec':
                        includeSystem = security <= 0.0;
                        break;
                    default:
                        includeSystem = true;
                }

                if (includeSystem) {
                    hasMatchingSystems = true;
                } else {
                    delete filteredConstellation[sysKey];
                }
            });

            if (Object.keys(filteredConstellation).length > 1) { // More than just constellationID
                filteredRegion[constKey] = filteredConstellation;
            }
        });

        if (hasMatchingSystems) {
            filtered[regionName] = filteredRegion;
        }
    });

    return filtered;
}

export function flattenMarketTree(marketTree) {
    const items = [];
    const pathMap = {}; // typeID -> array of category names

    function walkCategory(node, path = []) {
        if (!node || typeof node !== 'object') return;
        const entries = Array.isArray(node) ? node.map(n => [n.name, n]) : Object.entries(node);
        for (const [key, value] of entries) {
            if (!value || typeof value !== 'object') continue;
            // Items array on this category
            if (Array.isArray(value.items)) {
                for (const item of value.items) {
                    if (!item || typeof item !== 'object') continue;
                    items.push({ ...item });
                    pathMap[item.typeID] = [...path, key];
                }
            }
            // Recurse into child categories; skip metadata keys
            for (const [subKey, subValue] of Object.entries(value)) {
                if (subKey === 'items' || subKey === '_info') continue;
                if (subValue && typeof subValue === 'object') {
                    walkCategory(subValue, [...path, key]);
                }
            }
        }
    }

    walkCategory(marketTree, []);
    return { items, pathMap };
}
