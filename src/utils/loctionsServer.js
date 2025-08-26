// locationsServer.js
import fs from 'fs';
import path from 'path';

const PUBLIC_DATA_DIR = path.join(process.cwd(), 'public', 'data');
const STATIC_DATA_DIR = path.join(process.cwd(), 'src', 'data');

let stationsCache = null;
let structuresCache = null;
let regionsCache = null;

export function loadStations() {
  if (!stationsCache) {
    stationsCache = JSON.parse(
      fs.readFileSync(path.join(STATIC_DATA_DIR, 'stations.json'), 'utf-8')
    );
  }
  return stationsCache;
}

export function loadStructures() {
  if (!structuresCache) {
    structuresCache = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_DATA_DIR, 'structures.json'), 'utf-8')
    );
  }
  return structuresCache;
}

export function loadRegions() {
  if (!regionsCache) {
    regionsCache = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_DATA_DIR, 'regions.json'), 'utf-8')
    );
  }
  return regionsCache;
}

export function getStationInfo(id) {
  const stations = loadStations();
  return stations.find(s => s.stationID === Number(id));
}

export function getStructureInfo(id) {
  const structures = loadStructures();
  return structures.find(s => s.structureID === Number(id));
}

export function getRegionInfo(id) {
  const regions = loadRegions();
  return regions.find(r => r.regionID === Number(id));
}