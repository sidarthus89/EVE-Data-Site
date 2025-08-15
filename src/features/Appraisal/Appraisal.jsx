// src/features/Appraisal/Appraisal.jsx
import { useEffect, useState } from 'react';
import RegionSelector from '../RegionSelector/RegionSelector';
import { fetchRegionOrdersByID } from '../../api/esiAPI';

function flattenMarketData(marketData) {
    const itemMap = new Map();

    function walk(node) {
        if (node.items) {
            for (const item of node.items) {
                if (item.published && item.typeName) {
                    itemMap.set(item.typeName.toLowerCase(), item);
                }
            }
        }
        for (const key in node) {
            if (key !== 'items' && typeof node[key] === 'object') {
                walk(node[key]);
            }
        }
    }

    walk(marketData);
    return itemMap;
}

export default function AppraisalTool() {
    const [inputText, setInputText] = useState('');
    const [parsedItems, setParsedItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('all');
    const [locations, setLocations] = useState({});
    const [marketItemMap, setMarketItemMap] = useState(new Map());


    useEffect(() => {
        fetchJSON('market-tree')
            .then(setMarketTree)
            .catch(err => console.error('❌ Failed to load market-tree from Worker', err));
    }, []);

    useEffect(() => {
        fetchJSON('locations')
            .then(setLocationsData)
            .catch(err => console.error('❌ Failed to load locations from Worker', err));
    }, []);

    // Parse input against local market.json
    const parseInput = () => {
        const lines = inputText
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        const parsed = lines.map(line => {
            const match = line.match(/^(.*?)(?:\s+x(\d+))?$/);
            const name = match?.[1]?.trim() || '';
            const quantity = parseInt(match?.[2] || '1', 10);

            const item = marketItemMap.get(name.toLowerCase());
            if (!item) {
                console.warn(`❌ No match found in local market.json for: ${name}`);
                return null;
            }

            return {
                name: item.typeName,
                quantity,
                typeID: Number(item.typeID)
            };
        });

        return parsed.filter(item => item && item.typeID);
    };

    const handleAppraise = async () => {
        setLoading(true);
        setError('');
        setParsedItems([]);

        try {
            const parsed = parseInput();

            if (!parsed.length) {
                setError('❌ No valid items found to appraise.');
                setLoading(false);
                return;
            }

            // Handle "All Regions"
            if (selectedRegion === 'all') {
                // Get all region keys & regionIDs from locations.json
                const allRegions = Object.entries(locations).map(([regionName, data]) => ({
                    regionName,
                    regionID: data.regionID,
                }));

                // For each item and each region, fetch market orders
                const allRegionData = [];

                for (const item of parsed) {
                    for (const { regionName, regionID } of allRegions) {
                        try {
                            const orders = await fetchRegionOrdersByID(item.typeID, regionID);

                            const sell = orders
                                .filter(o => !o.is_buy_order && o.price > 0)
                                .sort((a, b) => a.price - b.price)[0];

                            const buy = orders
                                .filter(o => o.is_buy_order && o.price > 0)
                                .sort((a, b) => b.price - a.price)[0];

                            allRegionData.push({
                                ...item,
                                regionName,
                                sellPrice: sell?.price || 0,
                                buyPrice: buy?.price || 0,
                            });
                        } catch (e) {
                            console.error(`❌ Failed fetching orders for typeID ${item.typeID} in region ${regionName}:`, e);
                            allRegionData.push({
                                ...item,
                                regionName,
                                sellPrice: 0,
                                buyPrice: 0,
                            });
                        }
                    }
                }

                setParsedItems(allRegionData);
            } else {
                // Single region selected — same as before
                const regionID = locations?.[selectedRegion]?.regionID;
                if (!regionID) {
                    setError('❌ Invalid region selected');
                    setLoading(false);
                    return;
                }

                const updatedItems = await Promise.all(parsed.map(async item => {
                    try {
                        const orders = await fetchRegionOrdersByID(item.typeID, regionID);

                        const sell = orders
                            .filter(o => !o.is_buy_order && o.price > 0)
                            .sort((a, b) => a.price - b.price)[0];

                        const buy = orders
                            .filter(o => o.is_buy_order && o.price > 0)
                            .sort((a, b) => b.price - a.price)[0];

                        return {
                            ...item,
                            sellPrice: sell?.price || 0,
                            buyPrice: buy?.price || 0,
                        };
                    } catch (e) {
                        console.error(`❌ Failed fetching orders for typeID ${item.typeID}:`, e);
                        return {
                            ...item,
                            sellPrice: 0,
                            buyPrice: 0,
                        };
                    }
                }));

                setParsedItems(updatedItems);
            }
        } catch (e) {
            console.error('Appraisal error:', e);
            setError('❌ Something went wrong during appraisal.');
        }
        setLoading(false);
    };

    return (
        <div className="appraisal-tool">
            <h2 className='title'>Appraisal Tool</h2>

            <div className="region-selector-wrapper">
                <label htmlFor="region">Select Region:</label>
                <RegionSelector
                    selectedRegion={selectedRegion}
                    onRegionChange={({ regionName, regionID }) => {
                        setSelectedRegion(regionName);
                        setSelectedRegionID(regionID);
                    }}
                />
            </div>

            <textarea
                rows={8}
                placeholder="Paste your items here (e.g., Tritanium x1000)"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
            />

            <button onClick={handleAppraise} disabled={!inputText || loading}>
                {loading ? 'Appraising...' : 'Appraise Items'}
            </button>

            {error && <div className="error">{error}</div>}

            {parsedItems.length > 0 && (
                <table className="results-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Qty</th>
                            {selectedRegion === 'all' && <th>Region</th>}
                            <th>Buy Price (each)</th>
                            <th>Sell Price (each)</th>
                            <th>Total Sell</th>
                        </tr>
                    </thead>
                    <tbody>
                        {parsedItems.map((item, index) => (
                            <tr key={index}>
                                <td>{item.name}</td>
                                <td>{item.quantity}</td>
                                {selectedRegion === 'all' && <td>{item.regionName}</td>}
                                <td>{item.buyPrice?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                <td>{item.sellPrice?.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                <td>{(item.sellPrice * item.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
