// locationsClient.js
import stations from '../data/stations.json'; // baked into src/data

let structuresCache = null;
let regionsCache = null;

export async function loadStations() {
    return stations; // no fetch needed
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
    return stations.find(s => s.stationID === Number(id));
}

export async function getStructureInfo(id) {
    const structures = await loadStructures();
    return structures.find(s => s.structureID === Number(id));
}

export async function getRegionInfo(id) {
    const regions = await loadRegions();
    return regions.find(r => r.regionID === Number(id));
}