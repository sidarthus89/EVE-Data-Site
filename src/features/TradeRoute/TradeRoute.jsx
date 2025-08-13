//src/features/TradeRoute/TradeRoute.jsx

import React, { useState, useEffect, useRef } from 'react';
import './TradeRoute.css';
import { WORKER_KV_BASE } from '../../api/esiAPI';

const popularRegions = ['The Forge', 'Domain', 'Tenerifis', 'Sinq Laison', 'Essence'];

// Custom hooks
function useStationInfoMap() {
    const [stationInfoMap, setStationInfoMap] = useState({});

    useEffect(() => {
        fetch(`${WORKER_KV_BASE}locations`)
            .then(res => res.json())
            .then(data => {
                setStationInfoMap(data.stationLookup || {});
            })
            .catch(err => {
                console.warn('Failed to load station info map:', err);
                setStationInfoMap({});
            });
    }, []);

    return stationInfoMap;
}


function useColumnResize() {
    const [columnWidths, setColumnWidths] = useState({});
    const [isResizing, setIsResizing] = useState(false);
    const [resizingColumn, setResizingColumn] = useState(null);
    const startX = useRef(0);
    const startWidth = useRef(0);

    const handleMouseDown = (e, columnKey) => {
        setIsResizing(true);
        setResizingColumn(columnKey);
        startX.current = e.clientX;
        startWidth.current = columnWidths[columnKey] || 150;

        const handleMouseMove = (e) => {
            if (!isResizing || !resizingColumn) return;
            const diff = e.clientX - startX.current;
            const newWidth = Math.max(80, startWidth.current + diff);
            setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            setResizingColumn(null);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        e.preventDefault();
    };

    return { columnWidths, handleMouseDown, isResizing };
}

export default function TradeRoute() {
    const [locations, setLocations] = useState({});
    const [startRegion, setStartRegion] = useState({ regionName: 'All Regions', regionID: 'all' });
    const [endRegion, setEndRegion] = useState({ regionName: 'All Regions', regionID: 'all' });
    const [tradeMode, setTradeMode] = useState('buyToSell');
    const [profitAbove, setProfitAbove] = useState('');   // now truly starts empty
    const [roi, setROI] = useState('');
    const [budget, setBudget] = useState('');
    const [capacity, setCapacity] = useState('');
    const [maxJumps, setMaxJumps] = useState('');         // re-added maxJumps field
    const [salesTax, setSalesTax] = useState('');         // truly empty at start
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState([]);
    const [sortConfig, setSortConfig] = useState({ key: 'netProfit', direction: 'desc' });
    const [copyFeedback, setCopyFeedback] = useState({});
    const { columnWidths, handleMouseDown, isResizing } = useColumnResize();
    const stationInfoMap = useStationInfoMap();

    useEffect(() => {
        fetch(`${WORKER_KV_BASE}locations`)
            .then(res => res.json())
            .then(data => {
                setLocations(data || {});
            })
            .catch(err => {
                console.warn('Failed to load locations:', err);
                setLocations({});
            });
    }, []);


    const columns = [
        { key: 'itemName', label: 'Item', sortable: true, cssClass: 'trade-col-item-name', defaultWidth: '200px' },
        { key: 'from', label: 'From', sortable: true, cssClass: 'trade-col-station', defaultWidth: '250px', hasCopy: true },
        { key: 'quantity', label: 'Quantity', sortable: true, cssClass: 'trade-col-quantity', defaultWidth: '80px', isNumber: true },
        { key: 'buyPrice', label: 'Buy Price', sortable: true, cssClass: 'trade-col-price', defaultWidth: '100px', isNumber: true },
        { key: 'takeTo', label: 'Take To', sortable: true, cssClass: 'trade-col-station', defaultWidth: '250px', hasCopy: true },
        { key: 'sellPrice', label: 'Sell Price', sortable: true, cssClass: 'trade-col-price', defaultWidth: '100px', isNumber: true },
        { key: 'netProfit', label: 'Net Profit', sortable: true, cssClass: 'trade-col-profit', defaultWidth: '120px', isNumber: true, isProfit: true },
        { key: 'jumps', label: 'Jumps', sortable: true, cssClass: 'trade-col-quantity', defaultWidth: '80px', isNumber: true },
        { key: 'profitPerJump', label: 'Profit per Jump', sortable: true, cssClass: 'trade-col-profit', defaultWidth: '120px', isNumber: true },
        { key: 'profitPerItem', label: 'Profit Per Item', sortable: true, cssClass: 'trade-col-profit', defaultWidth: '120px', isNumber: true },
        { key: 'roi', label: 'ROI', sortable: true, cssClass: 'trade-col-roi', defaultWidth: '80px', isNumber: true, isROI: true },
        { key: 'totalVolume', label: 'Total Volume (m³)', sortable: true, cssClass: 'trade-col-volume', defaultWidth: '100px', isNumber: true },
    ];

    const getColumnWidth = (columnKey) =>
        columnWidths[columnKey] ||
        columns.find(c => c.key === columnKey)?.defaultWidth ||
        '100px';


    const copyToClipboard = async (text, rowIndex, columnKey) => {
        try {
            await navigator.clipboard.writeText(text);
            const feedbackKey = `${rowIndex}-${columnKey}`;
            setCopyFeedback(prev => ({ ...prev, [feedbackKey]: true }));
            setTimeout(() => {
                setCopyFeedback(prev => {
                    const newState = { ...prev };
                    delete newState[feedbackKey];
                    return newState;
                });
            }, 1000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    const renderRegionOptions = () => {
        const regionLookup = locations.regionLookup || {};
        const allRegionIDs = Object.keys(regionLookup).sort();

        const popularRegionIDs = allRegionIDs.filter(id =>
            popularRegions.includes(regionLookup[id])
        );
        const otherRegionIDs = allRegionIDs.filter(id =>
            !popularRegions.includes(regionLookup[id])
        );

        return (
            <>
                <option key="all" value="all">All Regions</option>
                {popularRegionIDs.length > 0 && (
                    <optgroup label="Popular Regions">
                        {popularRegionIDs.map(id => (
                            <option key={id} value={id}>{regionLookup[id]}</option>
                        ))}
                    </optgroup>
                )}
                {otherRegionIDs.length > 0 && (
                    <optgroup label="All Other Regions">
                        {otherRegionIDs.map(id => (
                            <option key={id} value={id}>{regionLookup[id]}</option>
                        ))}
                    </optgroup>
                )}
            </>
        );
    };

    const handleRegionChange = (setter) => (e) => {
        const regionID = e.target.value;
        if (regionID === 'all') {
            setter({ regionName: 'All Regions', regionID: 'all' });
            return;
        }
        const regionName = locations.regionLookup?.[regionID] || regionID;
        setter({ regionName, regionID });
    };

    const handleSearch = async () => {
        if (
            !startRegion.regionID ||
            startRegion.regionID === 'all' ||
            !endRegion.regionID ||
            endRegion.regionID === 'all'
        ) {
            alert('Please select valid regions for both start and end locations.');
            return;
        }

        setLoading(true);
        setProgress(0);
        setResults([]);

        try {
            const data = await fetchMarketData({
                startRegionID: startRegion.regionID,
                endRegionID: endRegion.regionID,
                tradeMode,
                profitAbove: profitAbove ? parseFloat(profitAbove) : 500000,
                roi: roi ? parseFloat(roi) : 0,
                budget: budget ? parseFloat(budget) : Infinity,
                capacity: capacity ? parseFloat(capacity) : Infinity,
                salesTax: salesTax ? parseFloat(salesTax) : 7.5,
                maxJumps: maxJumps ? parseInt(maxJumps) : Infinity,
                updateProgress: setProgress,
            });

            setResults(data);
        } catch (err) {
            alert('Error fetching market data: ' + err.message);
            console.error(err);
        } finally {
            setLoading(false);
            setProgress(100);
        }
    };

    const sortData = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedResults = [...results].sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (typeof aVal === 'string') {
            return sortConfig.direction === 'asc'
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        }
        return sortConfig.direction === 'asc'
            ? (aVal < bVal ? -1 : 1)
            : (aVal > bVal ? -1 : 1);
    });

    const formatCellValue = (value, column) => {
        if (column.key === 'quantity') return value.toLocaleString();
        if (column.key === 'jumps') return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
        if (column.isNumber && typeof value === 'number') {
            return value.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        }
        if (column.isROI) {
            return `${value.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            })}%`;
        }
        return value;
    };

    const getCellClasses = (column) => {
        let classes = `trade-table-cell ${column.cssClass}`;
        if (column.isNumber) classes += ' trade-cell-number';
        if (column.isProfit) classes += ' trade-cell-profit';
        if (column.isROI) classes += ' trade-cell-roi';
        if (column.hasCopy) classes += ' trade-cell-copyable';
        return classes;
    };

    const renderCellContent = (value, column, rowIndex) => {
        if (column.hasCopy) {
            const feedbackKey = `${rowIndex}-${column.key}`;
            const showFeedback = copyFeedback[feedbackKey];

            return (
                <div className="cell-with-copy">
                    <span className="cell-text">{formatCellValue(value, column)}</span>
                    <button
                        className={`copy-btn ${showFeedback ? 'copied' : ''}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(value, rowIndex, column.key);
                        }}
                        title="Copy to clipboard"
                    >
                        {showFeedback ? '✓' : '📋'}
                    </button>
                </div>
            );
        }
        return formatCellValue(value, column);
    };

    const inputFields = [
        {
            label: 'Starting Region',
            value: startRegion.regionName,
            onChange: handleRegionChange(setStartRegion),
            type: 'select',
            options: renderRegionOptions()
        },
        {
            label: 'Ending Region',
            value: endRegion.regionName,
            onChange: handleRegionChange(setEndRegion),
            type: 'select',
            options: renderRegionOptions()
        },
        {
            label: 'Trade Mode',
            value: tradeMode,
            onChange: (e) => setTradeMode(e.target.value),
            type: 'select',
            options: [
                <option key="sellToBuy" value="sellToBuy">Sell in Start / Buy in End</option>,
                <option key="buyToSell" value="buyToSell">Buy in Start / Sell in End</option>
            ]
        },
        {
            label: 'Profit Above (ISK)',
            value: profitAbove,
            onChange: (e) => setProfitAbove(e.target.value),
            type: 'number',
            placeholder: 'Default: 500000'
        },
        {
            label: 'ROI (%) Minimum',
            value: roi,
            onChange: (e) => setROI(e.target.value),
            type: 'number',
            placeholder: 'Default: 4%'
        },
        {
            label: 'Budget (ISK)',
            value: budget,
            onChange: (e) => setBudget(e.target.value),
            type: 'number',
            placeholder: 'Default: No Limit'
        },
        {
            label: 'Capacity (m³)',
            value: capacity,
            onChange: (e) => setCapacity(e.target.value),
            type: 'number',
            placeholder: 'Default: No Limit'
        },
        {
            label: 'Max Jumps',
            value: maxJumps,
            onChange: (e) => setMaxJumps(e.target.value),
            type: 'number',
            placeholder: 'Default: No Limit'
        },
        {
            label: 'Sales Tax Skill Level',
            value: salesTax,
            onChange: (e) => setSalesTax(e.target.value),
            type: 'select',
            options: [
                <option key="" value="" disabled hidden>
                    Default: No Skill (7.5%)
                </option>,
                <option key="6.675" value="6.675">Lvl I: 6.675%</option>,
                <option key="5.85" value="5.85">Lvl II: 5.85%</option>,
                <option key="5.025" value="5.025">Lvl III: 5.025%</option>,
                <option key="4.25" value="4.25">Lvl IV: 4.25%</option>,
                <option key="3.375" value="3.375">Lvl V: 3.375%</option>
            ]
        }
    ];

    return (
        <div className="trade-route-container">
            <h1>Trade Route Finder</h1>

            <div className="input-panel">
                {inputFields.map((field, index) => (
                    <div key={index} className="input-group">
                        <label>{field.label}</label>
                        {field.type === 'select' ? (
                            <select
                                className="region-selector"
                                value={field.value}
                                onChange={field.onChange}
                            >
                                {field.options}
                            </select>
                        ) : (
                            <input
                                type={field.type}
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={field.placeholder}
                            />
                        )}
                    </div>
                ))}

                <button onClick={handleSearch} disabled={loading}>
                    {loading ? 'Loading...' : 'Search'}
                </button>

                {loading && (
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </div>

            <div className="trade-results-panel">
                <div className="trade-table-header">
                    <h2 className="trade-table-title">Trade Routes</h2>
                    <span className="trade-results-count">{sortedResults.length} results</span>
                </div>

                <div
                    className="trade-market-table"
                    style={{ cursor: isResizing ? 'col-resize' : 'default' }}
                >
                    <div className="trade-thead">
                        <div className="trade-thead-row">
                            {columns.map((column) => (
                                <div
                                    key={column.key}
                                    className={`trade-column-header ${column.cssClass}`}
                                    style={{ width: getColumnWidth(column.key), position: 'relative' }}
                                    onClick={() => column.sortable && sortData(column.key)}
                                >
                                    <span>{column.label}</span>
                                    {sortConfig.key === column.key && (
                                        <span className="sort-indicator">
                                            {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                        </span>
                                    )}
                                    <div
                                        className="column-resizer"
                                        onMouseDown={(e) => handleMouseDown(e, column.key)}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="trade-tbody">
                        {sortedResults.length === 0 && (
                            <div className="trade-empty-row">No results to display</div>
                        )}
                        {sortedResults.map((row, idx) => (
                            <div key={`${row.itemId}-${idx}`} className="trade-table-row">
                                {columns.map(column => (
                                    <div
                                        key={column.key}
                                        className={getCellClasses(column)}
                                        style={{ width: getColumnWidth(column.key) }}
                                    >
                                        {renderCellContent(row[column.key], column, idx)}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}