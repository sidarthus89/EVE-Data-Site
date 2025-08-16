// src/features/TradeRoute/TradeRoute.jsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import './TradeRoute.css';
import RegionSelector from '../RegionSelector/RegionSelector';
import { WORKER_KV_BASE, fetchRegionOrdersByID, fetchOrdersForAllRegions, fetchJSON, fetchTradeRouteData } from '../../api/esiAPI';

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

// Get top traded items (you can customize this list)
const getTopTradedItems = async () => {
    try {
        const marketTree = await fetchJSON('market-tree');
        // Extract some popular items from market categories
        const topItems = [
            // PLEX
            { typeID: 44992, name: 'PLEX', volume: 0.01 },
            // Some popular ships and modules (you'll need to add more based on your market data)
            { typeID: 670, name: 'Capsule', volume: 500 },
            { typeID: 11196, name: 'Cormorant', volume: 15800 },
            // Add more items from your market tree data
        ];
        return topItems;
    } catch (err) {
        console.error('Failed to load market tree:', err);
        // Fallback to a basic list
        return [
            { typeID: 44992, name: 'PLEX', volume: 0.01 },
            { typeID: 670, name: 'Capsule', volume: 500 },
        ];
    }
};

export default function TradeRoute() {
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
    const [searchWarning, setSearchWarning] = useState('');
    const { columnWidths, handleMouseDown, isResizing } = useColumnResize();

    // Update search warning when regions change
    useEffect(() => {
        const bothAllRegions = startRegion.regionID === 'all' && endRegion.regionID === 'all';
        const oneAllRegions = startRegion.regionID === 'all' || endRegion.regionID === 'all';

        if (bothAllRegions) {
            setSearchWarning('⚠️ Searching all regions to all regions will be very data and time intensive. Consider selecting specific regions for better performance.');
        } else if (oneAllRegions) {
            setSearchWarning('⚠️ Searching with "All Regions" will be data and time intensive but will find the best opportunities across all regions.');
        } else {
            setSearchWarning('');
        }
    }, [startRegion.regionID, endRegion.regionID]);

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

    // Validate search parameters
    const validateSearchParams = () => {
        // Basic validation - both regions must be selected
        if (!startRegion.regionID || !endRegion.regionID) {
            return 'Please select valid regions for both start and end locations.';
        }

        // Check for same region selection (unless using 'all')
        if (startRegion.regionID !== 'all' &&
            endRegion.regionID !== 'all' &&
            startRegion.regionID === endRegion.regionID) {
            return 'Start and end regions cannot be the same. Please select different regions or use "All Regions" for one of them.';
        }

        // Validate numeric inputs
        if (profitAbove && (isNaN(parseFloat(profitAbove)) || parseFloat(profitAbove) < 0)) {
            return 'Profit Above must be a valid positive number.';
        }

        if (roi && (isNaN(parseFloat(roi)) || parseFloat(roi) < 0)) {
            return 'ROI must be a valid positive number.';
        }

        if (budget && (isNaN(parseFloat(budget)) || parseFloat(budget) <= 0)) {
            return 'Budget must be a valid positive number.';
        }

        if (capacity && (isNaN(parseFloat(capacity)) || parseFloat(capacity) <= 0)) {
            return 'Capacity must be a valid positive number.';
        }

        if (maxJumps && (isNaN(parseInt(maxJumps)) || parseInt(maxJumps) <= 0)) {
            return 'Max Jumps must be a valid positive integer.';
        }

        if (salesTax && (isNaN(parseFloat(salesTax)) || parseFloat(salesTax) < 0 || parseFloat(salesTax) > 100)) {
            return 'Sales Tax must be a valid number between 0 and 100.';
        }

        return null;
    };

    // Fetch market trade routes
    const handleSearch = async () => {
        // Validate inputs
        const validationError = validateSearchParams();
        if (validationError) {
            alert(validationError);
            return;
        }

        // Show confirmation for intensive searches
        const bothAllRegions = startRegion.regionID === 'all' && endRegion.regionID === 'all';
        const oneAllRegions = startRegion.regionID === 'all' || endRegion.regionID === 'all';

        if (bothAllRegions) {
            const confirmed = window.confirm(
                'Searching all regions to all regions will be very intensive and may take several minutes. ' +
                'This will check every possible route combination. Are you sure you want to continue?'
            );
            if (!confirmed) return;
        } else if (oneAllRegions) {
            const confirmed = window.confirm(
                'Searching with "All Regions" will be intensive and may take some time. ' +
                'Consider setting stricter filters (higher profit threshold, lower max jumps) to speed up the search. ' +
                'Continue?'
            );
            if (!confirmed) return;
        }

        setLoading(true);
        setProgress(0);
        setResults([]);

        try {
            const searchParams = {
                startRegionID: startRegion.regionID,
                endRegionID: endRegion.regionID,
                tradeMode,
                profitAbove: profitAbove ? parseFloat(profitAbove) : 500000,
                roi: roi ? parseFloat(roi) : 4,
                budget: budget ? parseFloat(budget) : Infinity,
                capacity: capacity ? parseFloat(capacity) : Infinity,
                salesTax: salesTax ? parseFloat(salesTax) : 7.5,
                maxJumps: maxJumps ? parseInt(maxJumps) : Infinity,
            };

            console.log('Starting trade route search with params:', searchParams);

            const data = await fetchTradeRouteData({ ...searchParams, updateProgress: setProgress });

            console.log(`Search completed. Found ${data.length} trade routes.`);
            setResults(data);

            // Show completion message for intensive searches
            if (bothAllRegions || oneAllRegions) {
                const message = `Search completed! Found ${data.length} trade routes across ${bothAllRegions ? 'all regions' : 'multiple regions'}.`;
                setTimeout(() => alert(message), 500);
            }

        } catch (err) {
            const errorMessage = err.message || 'Unknown error occurred';
            console.error('Trade route search error:', err);
            alert('Error calculating trade routes: ' + errorMessage);
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
        const aVal = typeof a[sortConfig.key] === 'string' ? parseFloat(a[sortConfig.key]) || a[sortConfig.key] : a[sortConfig.key];
        const bVal = typeof b[sortConfig.key] === 'string' ? parseFloat(b[sortConfig.key]) || b[sortConfig.key] : b[sortConfig.key];

        if (typeof aVal === 'string') {
            return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortConfig.direction === 'asc' ? (aVal < bVal ? -1 : 1) : (aVal > bVal ? -1 : 1);
    }), [results, sortConfig]);

    const formatCellValue = (value, column) => {
        if (column.key === 'quantity' || column.key === 'jumps') {
            return parseFloat(value).toLocaleString();
        }
        if (column.isNumber && typeof value !== 'undefined') {
            const numValue = typeof value === 'string' ? parseFloat(value) : value;
            return numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        if (column.isROI && typeof value !== 'undefined') {
            const numValue = typeof value === 'string' ? parseFloat(value) : value;
            return `${numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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
            <div className="info-banner" style={{
                padding: '10px',
                backgroundColor: '#e3f2fd',
                border: '1px solid #2196f3',
                borderRadius: '4px',
                marginBottom: '20px',
                fontSize: '14px'
            }}>
                <strong>Note:</strong> This is a client-side trade route calculator using real EVE market data.
                It searches through popular items and calculates profitable trade routes between regions.
                Jump distances are currently estimated - for production use, integrate with a proper routing service.
            </div>

            <div className="input-panel">
                <div className="input-group" style={{ gridColumn: 'span 1' }}>
                    <label>Starting Region</label>
                    <div style={{ padding: 0 }}>
                        <RegionSelector
                            selectedRegion={startRegion}
                            onRegionChange={setStartRegion}
                        />
                    </div>
                </div>

                <div className="input-group" style={{ gridColumn: 'span 1' }}>
                    <label>Ending Region</label>
                    <div style={{ padding: 0 }}>
                        <RegionSelector
                            selectedRegion={endRegion}
                            onRegionChange={setEndRegion}
                        />
                    </div>
                </div>

                {searchWarning && (
                    <div className="search-warning" style={{
                        gridColumn: '1 / -1',
                        padding: '10px',
                        backgroundColor: '#fff3cd',
                        border: '1px solid #ffeaa7',
                        borderRadius: '4px',
                        color: '#856404',
                        fontSize: '14px',
                        lineHeight: '1.4'
                    }}>
                        {searchWarning}
                    </div>
                )}

                <div className="input-group">
                    <label>Trade Mode</label>
                    <select value={tradeMode} onChange={(e) => setTradeMode(e.target.value)}>
                        <option value="buyToSell">Buy in Start / Sell in End</option>
                        <option value="sellToBuy">Sell in Start / Buy in End</option>
                    </select>
                </div>
                <div className="input-group">
                    <label>Profit Above (ISK)</label>
                    <input
                        type="number"
                        value={profitAbove}
                        onChange={e => setProfitAbove(e.target.value)}
                        placeholder="Default: 500,000"
                    />
                </div>
                <div className="input-group">
                    <label>ROI (%) Minimum</label>
                    <input
                        type="number"
                        step="0.1"
                        value={roi}
                        onChange={e => setROI(e.target.value)}
                        placeholder="Default: 4%"
                    />
                </div>
                <div className="input-group">
                    <label>Budget (ISK)</label>
                    <input
                        type="number"
                        value={budget}
                        onChange={e => setBudget(e.target.value)}
                        placeholder="Default: No Limit"
                    />
                </div>
                <div className="input-group">
                    <label>Capacity (m³)</label>
                    <input
                        type="number"
                        value={capacity}
                        onChange={e => setCapacity(e.target.value)}
                        placeholder="Default: No Limit"
                    />
                </div>
                <div className="input-group">
                    <label>Max Jumps</label>
                    <input
                        type="number"
                        value={maxJumps}
                        onChange={e => setMaxJumps(e.target.value)}
                        placeholder="Default: No Limit"
                    />
                </div>
                <div className="input-group">
                    <label>Sales Tax Skill Level</label>
                    <select value={salesTax} onChange={e => setSalesTax(e.target.value)}>
                        <option value="" disabled hidden>Default: No Skill (7.5%)</option>
                        <option value="7.5">No Skill: 7.5%</option>
                        <option value="6.675">Lvl I: 6.675%</option>
                        <option value="5.85">Lvl II: 5.85%</option>
                        <option value="5.025">Lvl III: 5.025%</option>
                        <option value="4.25">Lvl IV: 4.25%</option>
                        <option value="3.375">Lvl V: 3.375%</option>
                    </select>
                </div>

                <button
                    onClick={handleSearch}
                    disabled={loading}
                    style={{
                        gridColumn: '1 / -1',
                        padding: '12px 24px',
                        fontSize: '16px',
                        fontWeight: 'bold'
                    }}
                >
                    {loading ? `Searching... ${progress}%` : 'Search Trade Routes'}
                </button>

                {loading && (
                    <div className="progress-bar" style={{ gridColumn: '1 / -1', position: 'relative', backgroundColor: '#f0f0f0', height: '20px', borderRadius: '10px', overflow: 'hidden' }}>
                        <div className="progress-fill" style={{
                            width: `${progress}%`,
                            height: '100%',
                            backgroundColor: '#4caf50',
                            transition: 'width 0.3s ease'
                        }} />
                        <span className="progress-text" style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            color: '#333'
                        }}>{progress}%</span>
                    </div>
                )}
            </div>

            <div className="trade-results-panel">
                <div className="trade-table-header">
                    <h2 className="trade-table-title">
                        Trade Routes: {startRegion.regionName} → {endRegion.regionName}
                    </h2>
                    <span className="trade-results-count">{sortedResults.length} results</span>
                </div>

                <div className="trade-market-table" style={{ cursor: isResizing ? 'col-resize' : 'default' }}>
                    <div className="trade-thead">
                        <div className="trade-thead-row">
                            {columns.map(col => (
                                <div
                                    key={col.key}
                                    className={`trade-column-header ${col.cssClass}`}
                                    style={{ width: getColumnWidth(col.key), position: 'relative' }}
                                    onClick={() => col.sortable && sortData(col.key)}
                                >
                                    <span>{col.label}</span>
                                    {sortConfig.key === col.key && (
                                        <span className="sort-indicator">
                                            {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                        </span>
                                    )}
                                    <div className="column-resizer" onMouseDown={e => handleMouseDown(e, col.key)} />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="trade-tbody">
                        {sortedResults.length === 0 && !loading && (
                            <div className="trade-empty-row">
                                {results.length === 0 ? 'No profitable trade routes found. Try adjusting your search criteria (lower profit threshold, higher ROI, different regions).' : 'No results match your current sort.'}
                            </div>
                        )}
                        {loading && (
                            <div className="trade-empty-row">
                                Calculating trade routes... Fetching market data and analyzing opportunities.
                            </div>
                        )}
                        {sortedResults.map((row, idx) => (
                            <div key={`${row.itemId}-${idx}`} className="trade-table-row">
                                {columns.map(col => (
                                    <div
                                        key={col.key}
                                        className={getCellClasses(col)}
                                        style={{ width: getColumnWidth(col.key) }}
                                    >
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