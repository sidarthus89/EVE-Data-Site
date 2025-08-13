import { fetchMarketHistory } from '../utils/fetchers.js';
import { getRegionName } from '../utils/locations.js';

export async function handlePriceHistory(url) {
    const itemId = url.searchParams.get("itemId");
    const regions = url.searchParams.getAll("region");

    if (!itemId || regions.length === 0) {
        return new Response("Missing itemId or region", { status: 400 });
    }

    const allHistory = await Promise.all(
        regions.map(async regionId => {
            const history = await fetchMarketHistory(itemId, regionId);
            return history.map(entry => ({
                date: entry.date,
                average: entry.average,
                totalVolume: entry.volume,
                region: getRegionName(regionId)
            }));
        })
    );

    // Flatten and aggregate by date
    const aggregated = {};
    allHistory.flat().forEach(entry => {
        const key = entry.date;
        if (!aggregated[key]) {
            aggregated[key] = { date: key, averageSum: 0, volumeSum: 0, count: 0 };
        }
        aggregated[key].averageSum += entry.average;
        aggregated[key].volumeSum += entry.totalVolume;
        aggregated[key].count += 1;
    });

    const result = Object.values(aggregated).map(entry => ({
        date: entry.date,
        average: Math.round(entry.averageSum / entry.count),
        totalVolume: entry.volumeSum
    }));

    return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
    });
}