import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import oresData from './ores_minerals.json' assert { type: 'json' };

// Emulate __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const locationsPath = path.resolve(__dirname, '../../../public/data/locations.json');
const outputPath = path.resolve(__dirname, '../../../public/data/cachedOrePrices.json');

// Extract all relevant typeIDs
const ORE_TYPE_IDS = Array.from(
    new Set(
        oresData.ores.flatMap(ore =>
            ore.refined_output.map(output => output.typeID)
        )
    )
);

// Fetch average buy prices for a region
const fetchPricesForRegion = async (regionID) => {
    const result = {};
    const chunkSize = 100;

    for (let i = 0; i < ORE_TYPE_IDS.length; i += chunkSize) {
        const chunk = ORE_TYPE_IDS.slice(i, i + chunkSize);

        for (const typeID of chunk) {
            const url = `https://esi.evetech.net/latest/markets/${regionID}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`;

            try {
                const res = await fetch(url);
                const orders = await res.json();

                const prices = orders.map(o => o.price);
                const avgPrice =
                    prices.length > 0
                        ? prices.reduce((a, b) => a + b, 0) / prices.length
                        : 0;

                result[typeID] = { price: avgPrice };
            } catch (e) {
                console.error(`Error fetching typeID ${typeID} in region ${regionID}:`, e);
            }
        }
    }

    return result;
};

const main = async () => {
    const locations = JSON.parse(fs.readFileSync(locationsPath, 'utf-8'));
    const regionIDMap = Object.entries(locations)
        .filter(([_, val]) => val.regionID)
        .reduce((acc, [name, val]) => {
            acc[val.regionID] = name;
            return acc;
        }, {});

    const allPrices = {};
    const pricesByRegion = {};
    const countByTypeID = {};

    for (const regionID of Object.keys(regionIDMap)) {
        console.log(`📦 Fetching prices for region ${regionID} (${regionIDMap[regionID]})...`);
        const regionPrices = await fetchPricesForRegion(regionID);
        pricesByRegion[regionID] = regionPrices;

        for (const [typeID, { price }] of Object.entries(regionPrices)) {
            if (!allPrices[typeID]) {
                allPrices[typeID] = 0;
                countByTypeID[typeID] = 0;
            }
            allPrices[typeID] += price;
            countByTypeID[typeID] += 1;
        }
    }

    const avgAll = {};
    for (const typeID of Object.keys(allPrices)) {
        const avg = allPrices[typeID] / countByTypeID[typeID];
        avgAll[typeID] = { price: avg };
    }

    const final = {
        ...pricesByRegion,
        all: avgAll,
    };

    fs.writeFileSync(outputPath, JSON.stringify(final, null, 2));
    console.log(`✅ Wrote cachedOrePrices.json to ${outputPath}`);
};

main();
