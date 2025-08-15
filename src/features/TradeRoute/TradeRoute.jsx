// src/features/TradeRoute/TradeRoute.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import './TradeRoute.css';
import { WORKER_KV_BASE, fetchMarketData } from '../../api/esiAPI';

const popularRegions = ['The Forge', 'Domain', 'Tenerifis', 'Sinq Laison', 'Essence'];

// Custom hook for column resizing
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
            setColumnWidths(prev => ({ ...prev, [resizingColumn]: Math.max(80, startWidth.current + diff) }));
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

// Extract regions from locations data
function getAllRegions(locations) {
    if (!locations?.stationLookup) return [];
    const regionMap = {};
    Object.values(locations.stationLookup).forEach(loc => {
        if (loc.regionID && loc.regionName) regionMap[loc.regionID] = loc.regionName;
    });
    return Object.entries(regionMap)
        .map(([regionID, name]) => ({ regionID, name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

export default function TradeRoute() {
    const [locations, setLocations] = useState({});
    const [startRegion, setStartRegion] = useState({ regionName: 'All Regions', regionID: 'all' });
    const [endRegion, setEndRegion] = useState({ regionName: 'All Regions', regionID: 'all' });
    const [tradeMode, setTradeMode] = useState('buyToSell');
    const [profitAbove, setProfitAbove] = useState('');
    const [roi, setROI] = useState('');
    const [budget, setBudget] = useState('');
    const [capacity, setCapacity] = useState('');
    const [maxJumps, setMaxJumps] = useState('');
    const [salesTax, setSalesTax] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [results, setResults] = useState([]);
    const [sortConfig, setSortConfig] = useState({ key: 'netProfit', direction: 'desc' });
    const [copyFeedback, setCopyFeedback] = useState({});
    const { columnWidths, handleMouseDown, isResizing } = useColumnResize();

    // Load locations from Worker KV
    useEffect(() => {
        const loadLocations = async () => {
            try {
                const res = await fetch(`${WORKER_KV_BASE}locations`);
                if (!res.ok) throw new Error(`Failed to fetch locations: ${res.status}`);
                const data = await res.json();
                setLocations(data || {});
            } catch (err) {
                console.warn('Failed to load locations:', err);
                setLocations({});
            }
        };
        loadLocations();
    }, []);

    // Columns definition
    const columns = useMemo(() => [
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
    ], []);

    const getColumnWidth = (columnKey) =>
        columnWidths[columnKey] || columns.find(c => c.key === columnKey)?.defaultWidth || '100px';

    // Copy to clipboard with feedback
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

    // Region options for select
    const regionOptions = useMemo(() => getAllRegions(locations), [locations]);
    const renderRegionOptions = () => {
        const popular = regionOptions.filter(r => popularRegions.includes(r.name));
        const others = regionOptions.filter(r => !popularRegions.includes(r.name));
        return (
            <>
                <option value="all">All Regions</option>
                {popular.length > 0 && (
                    <optgroup label="Popular Regions">
                        {popular.map(r => <option key={r.regionID} value={r.regionID}>{r.name}</option>)}
                    </optgroup>
                )}
                {others.length > 0 && (
                    <optgroup label="All Other Regions">
                        {others.map(r => <option key={r.regionID} value={r.regionID}>{r.name}</option>)}
                    </optgroup>
                )}
            </>
        );
    };

    const handleRegionChange = (setter) => (e) => {
        const regionID = e.target.value;
        if (regionID === 'all') return setter({ regionName: 'All Regions', regionID: 'all' });
        const regionName = locations.stationLookup?.[regionID]?.regionName || regionID;
        setter({ regionName, regionID });
    };

    // Fetch market trade routes
    const handleSearch = async () => {
        if (!startRegion.regionID || startRegion.regionID === 'all' || !endRegion.regionID || endRegion.regionID === 'all') {
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

    // Sorting
    const sortData = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const sortedResults = useMemo(() => [...results].sort((a, b) => {
        const aVal = a[sortConfig.key], bVal = b[sortConfig.key];
        if (typeof aVal === 'string') return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        return sortConfig.direction === 'asc' ? (aVal < bVal ? -1 : 1) : (aVal > bVal ? -1 : 1);
    }), [results, sortConfig]);

    const formatCellValue = (value, column) => {
        if (column.key === 'quantity' || column.key === 'jumps') return value.toLocaleString();
        if (column.isNumber && typeof value === 'number') return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (column.isROI) return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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
            return (
                <div className="cell-with-copy">
                    <span className="cell-text">{formatCellValue(value, column)}</span>
                    <button
                        className={`copy-btn ${copyFeedback[feedbackKey] ? 'copied' : ''}`}
                        onClick={(e) => { e.stopPropagation(); copyToClipboard(value, rowIndex, column.key); }}
                        title="Copy to clipboard"
                    >
                        {copyFeedback[feedbackKey] ? '✓' : '📋'}
                    </button>
                </div>
            );
        }
        return formatCellValue(value, column);
    };

    return (
        <div className="trade-route-container">
            <h1>Trade Route Finder</h1>

            <div className="input-panel">
                <div className="input-group">
                    <label>Starting Region</label>
                    <select className="region-selector" value={startRegion.regionID} onChange={handleRegionChange(setStartRegion)}>
                        {renderRegionOptions()}
                    </select>
                </div>
                <div className="input-group">
                    <label>Ending Region</label>
                    <select className="region-selector" value={endRegion.regionID} onChange={handleRegionChange(setEndRegion)}>
                        {renderRegionOptions()}
                    </select>
                </div>
                <div className="input-group">
                    <label>Trade Mode</label>
                    <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value)}>
                        <option value="sellToBuy">Sell in Start / Buy in End</option>
                        <option value="buyToSell">Buy in Start / Sell in End</option>
                    </select>
                </div>
                <div className="input-group">
                    <label>Profit Above (ISK)</label>
                    <input type="number" value={profitAbove} onChange={e => setProfitAbove(e.target.value)} placeholder="Default: 500000" />
                </div>
                <div className="input-group">
                    <label>ROI (%) Minimum</label>
                    <input type="number" value={roi} onChange={e => setROI(e.target.value)} placeholder="Default: 4%" />
                </div>
                <div className="input-group">
                    <label>Budget (ISK)</label>
                    <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="Default: No Limit" />
                </div>
                <div className="input-group">
                    <label>Capacity (m³)</label>
                    <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="Default: No Limit" />
                </div>
                <div className="input-group">
                    <label>Max Jumps</label>
                    <input type="number" value={maxJumps} onChange={e => setMaxJumps(e.target.value)} placeholder="Default: No Limit" />
                </div>
                <div className="input-group">
                    <label>Sales Tax Skill Level</label>
                    <select value={salesTax} onChange={e => setSalesTax(e.target.value)}>
                        <option value="" disabled hidden>Default: No Skill (7.5%)</option>
                        <option value="6.675">Lvl I: 6.675%</option>
                        <option value="5.85">Lvl II: 5.85%</option>
                        <option value="5.025">Lvl III: 5.025%</option>
                        <option value="4.25">Lvl IV: 4.25%</option>
                        <option value="3.375">Lvl V: 3.375%</option>
                    </select>
                </div>

                <button onClick={handleSearch} disabled={loading}>{loading ? 'Loading...' : 'Search'}</button>

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

                <div className="trade-market-table" style={{ cursor: isResizing ? 'col-resize' : 'default' }}>
                    <div className="trade-thead">
                        <div className="trade-thead-row">
                            {columns.map(col => (
                                <div key={col.key} className={`trade-column-header ${col.cssClass}`} style={{ width: getColumnWidth(col.key), position: 'relative' }} onClick={() => col.sortable && sortData(col.key)}>
                                    <span>{col.label}</span>
                                    {sortConfig.key === col.key && <span className="sort-indicator">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
                                    <div className="column-resizer" onMouseDown={e => handleMouseDown(e, col.key)} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="trade-tbody">
                        {sortedResults.length === 0 && <div className="trade-empty-row">No results to display</div>}
                        {sortedResults.map((row, idx) => (
                            <div key={`${row.itemId}-${idx}`} className="trade-table-row">
                                {columns.map(col => (
                                    <div key={col.key} className={getCellClasses(col)} style={{ width: getColumnWidth(col.key) }}>
                                        {renderCellContent(row[col.key], col, idx)}
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
