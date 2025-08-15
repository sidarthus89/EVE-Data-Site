// src/api/dataTransforms.js

export function buildStationRegionMap(locationsData) {
    const map = {};

    Object.entries(locationsData).forEach(([regionName, region]) => {
        Object.values(region).forEach(constellation => {
            Object.values(constellation).forEach(system => {
                if (system.stations) {
                    Object.entries(system.stations).forEach(([stationID, station]) => {
                        map[parseInt(stationID)] = regionName;
                    });
                }
            });
        });
    });

    return map;
}

export function buildRegionList(locationsData) {
    const list = [];

    Object.entries(locationsData).forEach(([regionName, regionBlock]) => {
        const regionID = regionBlock?.regionID;
        if (regionID && regionName) {
            list.push({ regionID, regionName });
        }
    });

    return list;
}