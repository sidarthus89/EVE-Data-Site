// src/features/Appraisal/Appraisal.jsx
import { useEffect, useState, useMemo } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    flexRender
} from '@tanstack/react-table';
import RegionSelector from '../RegionSelector/RegionSelector';
import { fetchRegionOrdersByID, fetchMarketTree, fetchLocations } from '../../api/esiAPI';

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
            .then(setLocations)
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
            <h2 className='title'>Appraisal Tool</h2>

            {/* Use shared RegionSelector with no extra wrapper/label for consistency */}
            <RegionSelector
                selectedRegion={selectedRegion}
                onRegionChange={setSelectedRegion}
            />

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
            )}
        </div>
    );
}