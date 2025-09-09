// locationsClient.js
// Runtime loaders for location metadata from /public/data

let structuresCache = null;
let regionsCache = null;
let stationsCache = null;

export async function loadStations() {
    if (stationsCache) return stationsCache;
    const url = `${import.meta.env.BASE_URL}data/stations.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load stations');
    stationsCache = await res.json();
    return stationsCache;
}

export async function loadStructures() {
    if (structuresCache) return structuresCache;
    const url = `${import.meta.env.BASE_URL}data/structures.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load structures');
    structuresCache = await res.json();
    return structuresCache;
}

export async function loadRegions() {
    if (regionsCache) return regionsCache;
    const url = `${import.meta.env.BASE_URL}data/regions.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load regions');
    regionsCache = await res.json();
    return regionsCache;
}

export async function getStationInfo(id) {
    const stations = await loadStations();
    return stations.find(s => Number(s.stationID || s.station_id) === Number(id));
}

export async function getStructureInfo(id) {
    const structures = await loadStructures();
    return structures.find(s => s.structureID === Number(id));
}

export async function getRegionInfo(id) {
    const regions = await loadRegions();
    return regions.find(r => r.regionID === Number(id));
}