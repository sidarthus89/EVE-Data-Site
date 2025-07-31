const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const locationsPath = path.resolve(__dirname, '../public/data/locations.json');
const outputPath = path.resolve(__dirname, '../public/data/oreCachePrices.json');
const oresData = require('../src/features/Ores/ores_minerals.json'); // adjust path if needed

const ORE_TYPE_IDS = Array.from(
    new Set(
        oresData.ores.flatMap(ore =>
            ore.refined_output.map(output => output.typeID)
        )
    )
);

const fetchPricesForRegion = async (regionID) => {
    const result = {};

    const chunkSize = 100;
    for (let i = 0; i < ORE_TYPE_IDS.length; i += chunkSize) {
        const chunk = ORE_TYPE_IDS.slice(i, i + chunkSize);
        const typeString = chunk.join(',');

        const url = `https://esi.evetech.net/latest/markets/${regionID}/orders/?datasource=tranquility&order_type=buy&type_id=${chunk[0]}`;
        try {
            const res = await fetch(url);
            const data = await res.json();

            for (const typeID of chunk) {
                // Fetch market orders and calculate average buy price for each typeID
                const ordersRes = await fetch(`https://esi.evetech.net/latest/markets/${regionID}/orders/?datasource=tranquility&order_type=buy&type_id=${typeID}`);
                const orders = await ordersRes.json();

                const prices = orders.map(o => o.price);
                const avgPrice =
                    prices.length > 0
                        ? prices.reduce((a, b) => a + b, 0) / prices.length
                        : 0;

                result[typeID] = { price: avgPrice };
            }
        } catch (e) {
            console.error(`Error fetching prices for region ${regionID}:`, e);
        }
    }

    return result;
};

(async () => {
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
        console.log(`Fetching prices for region ${regionID} (${regionIDMap[regionID]})...`);
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

    // Calculate "all" average
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
    console.log(`✅ Wrote oreCachePrices.json to ${outputPath}`);
})();
