// src/features/Appraisal/Appraisal.jsx
import { useEffect, useState, useMemo, useCallback } from 'react';
import {
    formatISK,
    getSecurityColor,
    getStationInfo,
    getRegionInfo
} from '../../utils/common.js';

import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender
} from '@tanstack/react-table';
import RegionSelector from '../../components/RegionSelector/RegionSelector';

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
    const [selectedRegion, setSelectedRegion] = useState({ regionName: 'All Regions', regionID: 'all' });
    const [locations, setLocations] = useState({});
    const [marketTree, setMarketTree] = useState(null);
    const [marketItemMap, setMarketItemMap] = useState(new Map());
    const [locationInfoMap, setlocationInfoMap] = useState({});

    // Function to build station info map from locations data
    const buildlocationInfoMap = useCallback((locationsData) => {
        const map = {};
        Object.entries(locationsData).forEach(([regionName, regionData]) => {
            Object.entries(regionData).forEach(([constellationName, constellationData]) => {
                if (constellationName === 'regionID') return;
                Object.entries(constellationData).forEach(([systemName, systemData]) => {
                    if (!systemData?.stations) return;
                    Object.entries(systemData.stations).forEach(([stationID, station]) => {
                        map[stationID] = {
                            name: station.locationName,
                            security: station.security ?? systemData.security ?? null,
                            region: regionName,
                            system: systemName,
                            constellation: constellationName,
                        };
                    });
                });
            });
        });
        return map;
    }, []);

    useEffect(() => {
        fetchMarketTree()
            .then(tree => {
                setMarketTree(tree);
                // Flatten and set item map
                if (tree) {
                    let treeArray = tree;
                    if (!Array.isArray(tree) && typeof tree === 'object') {
                        treeArray = Object.entries(tree).map(([name, node]) => ({ ...node, name }));
                    }
                    setMarketItemMap(flattenMarketData(treeArray));
                }
            })
            .catch(err => console.error('❌ Failed to load market-tree from Worker', err));
    }, []);

    useEffect(() => {
        fetchLocations()
            .then(data => {
                setLocations(data);
                setlocationInfoMap(buildlocationInfoMap(data));
            })
            .catch(err => console.error('❌ Failed to load locations from Worker', err));
    }, [buildlocationInfoMap]);

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
            if (selectedRegion.regionID === 'all') {
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
                const regionBlock = locations?.[selectedRegion.regionName];
                const regionID = regionBlock?.regionID;
                if (!regionID) {
                    setError('❌ Invalid region selected');
                    setLoading(false);
                    return;
                }

                const updatedItems = await Promise.all(parsed.map(async item => {
                    try {
                        const orders = await fetchRegionOrdersByID(item.typeID, regionID);

                        const sellOrders = orders
                            .filter(o => !o.is_buy_order && o.price > 0)
                            .sort((a, b) => a.price - b.price);
                        const buyOrders = orders
                            .filter(o => o.is_buy_order && o.price > 0)
                            .sort((a, b) => b.price - a.price);

                        const sell = sellOrders[0];
                        const buy = buyOrders[0];

                        const sellStation = sell ? {
                            locationId: sell.location_id,
                            name: locationInfoMap[sell.location_id]?.name || 'Unknown Station',
                            security: locationInfoMap[sell.location_id]?.security || 0,
                            region: locationInfoMap[sell.location_id]?.region || 'Unknown Region'
                        } : null;

                        const buyStation = buy ? {
                            locationId: buy.location_id,
                            name: locationInfoMap[buy.location_id]?.name || 'Unknown Station',
                            security: locationInfoMap[buy.location_id]?.security || 0,
                            region: locationInfoMap[buy.location_id]?.region || 'Unknown Region'
                        } : null;

                        return {
                            ...item,
                            sellPrice: sell?.price || 0,
                            buyPrice: buy?.price || 0,
                            sellStation: sellStation,
                            buyStation: buyStation
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

    // Sell orders columns (what you can buy items for - lowest prices)
    const sellColumns = useMemo(() => {
        const cols = [
            { accessorKey: 'name', header: 'Item', cell: info => info.getValue() },
            { accessorKey: 'quantity', header: 'Qty', cell: info => info.getValue().toLocaleString() },
        ];
        if (selectedRegion.regionID === 'all') {
            cols.push({ accessorKey: 'regionName', header: 'Region', cell: info => info.getValue() });
        }
        cols.push(
            { accessorKey: 'sellPrice', header: 'Price (each)', cell: info => info.getValue()?.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
            { accessorKey: 'totalSell', header: 'Total Value', cell: info => (info.row.original.sellPrice * info.row.original.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
        );
        return cols;
    }, [selectedRegion]);

    // Buy orders columns (what you can sell items for - highest prices)
    const buyColumns = useMemo(() => {
        const cols = [
            { accessorKey: 'name', header: 'Item', cell: info => info.getValue() },
            { accessorKey: 'quantity', header: 'Qty', cell: info => info.getValue().toLocaleString() },
        ];
        if (selectedRegion.regionID === 'all') {
            cols.push({ accessorKey: 'regionName', header: 'Region', cell: info => info.getValue() });
        }
        cols.push(
            { accessorKey: 'buyPrice', header: 'Price (each)', cell: info => info.getValue()?.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
            { accessorKey: 'totalBuy', header: 'Total Value', cell: info => (info.row.original.buyPrice * info.row.original.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
        );
        return cols;
    }, [selectedRegion]);

    const sellTable = useReactTable({
        data: parsedItems,
        columns: sellColumns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        debugTable: false,
    });

    const buyTable = useReactTable({
        data: parsedItems,
        columns: buyColumns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        debugTable: false,
    });

    return (
        <div className="appraisal-tool">
            <div className="appraisal-header">
                <h2>Create Appraisal</h2>
                <p className="appraisal-description">
                    You can use this tool to appraise large sets of items. Paste lists of items from in-game sources (contracts, fits, hangars, ledgers, etc) into the box below.
                </p>
            </div>

            <div className="appraisal-grid">
                <div className="input-section">
                    <div className="control-row">
                        <label>Region:</label>
                        <RegionSelector
                            selectedRegion={selectedRegion}
                            onRegionChange={setSelectedRegion}
                        />
                    </div>

                    <textarea
                        className="appraisal-input"
                        rows={12}
                        placeholder="Paste your items here..."
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                    />

                    <div className="button-row">
                        <button className="reset-btn">Reset</button>
                        <button
                            className="submit-btn"
                            onClick={handleAppraise}
                            disabled={!inputText || loading}
                        >
                            {loading ? 'Appraising...' : 'Submit'}
                        </button>
                    </div>
                </div>

                {parsedItems.length > 0 && (
                    <div className="results-section">
                        <div className="totals-banner">
                            <div className="total-value">
                                <span className="value">{(parsedItems.reduce((sum, item) => sum + (item.sellPrice * item.quantity), 0)).toLocaleString('en-US', { maximumFractionDigits: 1 })}k</span>
                                <span className="label">sell estimate</span>
                            </div>
                            <div className="total-value">
                                <span className="value">{(parsedItems.reduce((sum, item) => sum + (item.buyPrice * item.quantity), 0)).toLocaleString('en-US', { maximumFractionDigits: 1 })}k</span>
                                <span className="label">buy estimate</span>
                            </div>
                            <div className="total-value">
                                <span className="value">
                                    {parsedItems.reduce((sum, item) => sum + item.quantity, 0)}
                                </span>
                                <span className="label">total volume</span>
                            </div>
                        </div>

                        <div className="market-table-wrapper">
                            <div className="market-table">
                                <div className="thead">
                                    <div className="thead-row">
                                        <div className="column-header" style={{ width: 200 }}>Item</div>
                                        <div className="column-header" style={{ width: 250 }}>Quantity Location (Buy)</div>
                                        <div className="column-header" style={{ width: 250 }}>Price Location</div>
                                        <div className="column-header" style={{ width: 200 }}>Price</div>
                                        <div className="column-header" style={{ width: 150 }}>Total Value</div>
                                    </div>
                                </div>
                                <div className="table-body">
                                    {parsedItems.map((item, index) => (
                                        <div key={index} className="table-row">
                                            <div className="table-cell" style={{ width: 200 }}>
                                                {item.name} {item.quantity.toLocaleString()}
                                            </div>
                                            <div className="table-cell location-cell" style={{ width: 250 }}>
                                                {item.buyStation ? (
                                                    <div className="station-info">
                                                        <span className="sec-cell" style={{ color: getSecurityColor(item.buyStation.security) }}>
                                                            {item.buyStation.security >= 0 ? ` ${item.buyStation.security.toFixed(1)}` : item.buyStation.security.toFixed(1)}
                                                        </span>
                                                        <span className="location-text">{item.buyStation.name}</span>
                                                    </div>
                                                ) : '---'}
                                            </div>
                                            <div className="table-cell location-cell" style={{ width: 250 }}>
                                                {item.sellStation ? (
                                                    <div className="station-info">
                                                        <span className="sec-cell" style={{ color: getSecurityColor(item.sellStation.security) }}>
                                                            {item.sellStation.security >= 0 ? ` ${item.sellStation.security.toFixed(1)}` : item.sellStation.security.toFixed(1)}
                                                        </span>
                                                        <span className="location-text">{item.sellStation.name}</span>
                                                    </div>
                                                ) : '---'}
                                            </div>
                                            <div className="table-cell" style={{ width: 200 }}>
                                                {item.buyPrice ? formatISK(item.buyPrice) : '---'} / {item.sellPrice ? formatISK(item.sellPrice) : '---'}
                                            </div>
                                            <div className="table-cell" style={{ width: 150 }}>
                                                {formatISK((item.sellPrice || 0) * item.quantity)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="price-info">
                            <p>These numbers are from market orders at the time of appraisal. Use the "Update prices" button to create a new appraisal based on current prices.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    ); { error && <div className="error">{error}</div> }

    {
        parsedItems.length > 0 && (
            <>
                <div className="market-table-wrapper">
                    <h3 className="market-table-title">Sell Orders - Lowest Prices (What you pay to buy)</h3>
                    <div className="market-table">
                        <div className="thead">
                            {sellTable.getHeaderGroups().map(headerGroup => (
                                <div key={headerGroup.id} className="thead-row">
                                    {headerGroup.headers.map(header => (
                                        <div
                                            className="column-header"
                                            key={header.id}
                                            style={{ width: header.getSize ? header.getSize() : 120, minWidth: 80 }}
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div className="table-body">
                            {sellTable.getRowModel().rows.map(row => (
                                <div className="table-row" key={row.id}>
                                    {row.getVisibleCells().map(cell => (
                                        <div
                                            className="table-cell"
                                            key={cell.id}
                                            style={{ width: cell.column.getSize ? cell.column.getSize() : 120, minWidth: 80 }}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="market-table-wrapper">
                    <h3 className="market-table-title">Buy Orders - Highest Prices (What you get for selling)</h3>
                    <div className="market-table">
                        <div className="thead">
                            {buyTable.getHeaderGroups().map(headerGroup => (
                                <div key={headerGroup.id} className="thead-row">
                                    {headerGroup.headers.map(header => (
                                        <div
                                            className="column-header"
                                            key={header.id}
                                            style={{ width: header.getSize ? header.getSize() : 120, minWidth: 80 }}
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                        <div className="table-body">
                            {buyTable.getRowModel().rows.map(row => (
                                <div className="table-row" key={row.id}>
                                    {row.getVisibleCells().map(cell => (
                                        <div
                                            className="table-cell"
                                            key={cell.id}
                                            style={{ width: cell.column.getSize ? cell.column.getSize() : 120, minWidth: 80 }}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </>
        )
    }
}