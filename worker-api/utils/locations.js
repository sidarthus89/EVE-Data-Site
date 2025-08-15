// worker-api/utils/locations.js

import locations from '../data/locations.json';

export function getStationName(stationID) {
    return locations[stationID]?.name ?? "Unknown Station";
}

export function getSecurityLevel(stationID) {
    return locations[stationID]?.security ?? 0.0;
}

export function getRegionName(regionID) {
    for (const loc of Object.values(locations)) {
        if (loc.regionID === Number(regionID)) {
            return loc.regionName;
        }
    }
    return "Unknown Region";
}

export function getAllRegions() {
    const regionMap = {};

    for (const loc of Object.values(locations)) {
        const { regionID, regionName } = loc;
        if (regionID && regionName) {
            regionMap[regionID] = regionName;
        }
    }

    return Object.entries(regionMap)
        .map(([regionID, name]) => ({ regionID, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

}