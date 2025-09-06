// src/features/TradeTools/RegionHauling.jsx
import React, { useState, useEffect, useMemo } from 'react';
import RegionSelector from '../../components/RegionSelector/RegionSelector.jsx';
import { getSecurityColor, getStationInfo, getRegionInfo } from '../../utils/common.js';
import { fetchMarketOrders, fetchRegionHaulingData } from '../../utils/market.js';
import { fetchRegions, fetchWithRetry, fetchStructures } from '../../utils/api.js';
import stations from '../../data/stations.json';
import './RegionHauling.css';

// Utility functions for formatting (replaces eveTradeAPI utils)
const utils = {
    formatNumber: (value, decimals = 2) => {
        if (value === null || value === undefined || isNaN(value)) return '0';
        const num = parseFloat(value);
        return num.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }
};

const INITIAL_FORM = {
    fromRegion: null,
    toRegion: null,
    nearbyOnly: false,
    minProfit: '500000', // Default value for Min Profit
    maxWeight: '',
    minROI: 4, // Default value, not placeholder
    maxJumps: '',
    maxBudget: '',
    salesTax: 7.5, // Default to "No Skill"
    securityStatus: 'any',
    structureType: 'both',
    routePreference: 'safest',
    hideOutOfStock: false
};

export default function RegionHauling() {
    const [formData, setFormData] = useState(INITIAL_FORM);
    const [regionsData, setRegionsData] = useState(null);
    const [marketTree, setMarketTree] = useState(null);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]);
    const [error, setError] = useState(null);
    const [usingFallback, setUsingFallback] = useState(false);
    const [nearbyRegions, setNearbyRegions] = useState([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(50);
    const [isFormSticky, setIsFormSticky] = useState(false);
    const [formCollapsed, setFormCollapsed] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [showResults, setShowResults] = useState(false);

    // Fetch item details (volume and name) from ESI
    const fetchItemDetails = async (typeId) => {
        try {
            const response = await fetchWithRetry(`https://esi.evetech.net/latest/universe/types/${typeId}/`);
            return {
                volume: response.volume || 0.01,
                name: response.name || `Item ${typeId}`
            };
        } catch (error) {
            console.warn(`Failed to fetch details for type ${typeId}:`, error);
            return {
                volume: 0.01,
                name: `Item ${typeId}`
            };
        }
    };

    // Calculate jumps between two systems
    const calculateJumps = async (fromSystemId, toSystemId) => {
        try {
            const routeResponse = await fetchWithRetry(
                `https://esi.evetech.net/latest/route/${fromSystemId}/${toSystemId}/`
            );
            return routeResponse.length - 1; // Number of jumps is route length minus 1
        } catch (error) {
            console.warn(`Failed to calculate jumps from ${fromSystemId} to ${toSystemId}:`, error);
            return 'N/A';
        }
    };

    // Handle form sticky behavior on scroll
    useEffect(() => {
        const handleScroll = () => {
            const formElement = document.querySelector('.hauling-form');
            if (formElement) {
                const formRect = formElement.getBoundingClientRect();
                const navbarHeight = 60; // Adjust based on your navbar height
                setIsFormSticky(formRect.top <= navbarHeight);
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Copy location name to clipboard
    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
        }
    };

    // Fast region loading using same system as Market.jsx
    useEffect(() => {
        fetchRegions()
            .then(regions => {
                setRegionsData(regions);
            })
            .catch(err => {
                console.error('🚛 ❌ Failed to load regions', err);
                setError('Failed to load regions data');
            });
    }, []);

    // Memoized regions for performance (same as Market.jsx)
    const regions = useMemo(() => {
        if (!regionsData) return [];

        // Convert to consistent format
        return regionsData.map(region => ({
            regionID: region.region_id || region.regionID,
            regionName: region.region_name || region.regionName || region.name,
            ...region
        }));
    }, [regionsData]);

    // Calculate nearby regions when fromRegion changes (simplified without EVE-Trade data)
    useEffect(() => {
        if (formData.fromRegion && regions.length > 0) {
            setNearbyRegions([]);
        } else {
            setNearbyRegions([]);
        }
    }, [formData.fromRegion, regions]);

    // Auto-set toRegion when nearbyOnly is checked (only if nearby regions available)
    useEffect(() => {
        if (formData.nearbyOnly && nearbyRegions.length > 0) {
            setFormData(prev => ({
                ...prev,
                toRegion: {
                    regionID: 'nearby',
                    regionName: `${nearbyRegions.length} Nearby Regions`
                }
            }));
        } else if (!formData.nearbyOnly && formData.toRegion?.regionID === 'nearby') {
            setFormData(prev => ({
                ...prev,
                toRegion: null
            }));
        }
    }, [formData.nearbyOnly, nearbyRegions]);

    // Data transformation function to convert API/market data to display format
    const transformApiResponseToDisplayFormat = async (apiData, formData) => {
        // Load static structure data for mapping
        const structures = await fetchStructures();
        const stationMap = new Map(stations.map(s => [Number(s.station_id || s.stationID), s]));
        const structMap = new Map(structures.map(s => [Number(s.stationID), s]));

        if (!apiData || !Array.isArray(apiData)) {
            return [];
        }

        // Get cargo capacity from form (convert to number, default to unlimited if not specified)
        const cargoCapacity = formData.maxWeight ? parseFloat(formData.maxWeight) : null;

        const transformedTrades = [];

        for (const trade of apiData) {

            // Get item details (volume and name) from ESI
            const itemDetails = await fetchItemDetails(trade.type_id);

            // Calculate maximum units that can fit in cargo hold
            let maxUnits = trade.max_volume || 0;
            if (cargoCapacity && itemDetails.volume > 0) {
                const cargoLimitedUnits = Math.floor(cargoCapacity / itemDetails.volume);
                maxUnits = Math.min(maxUnits, cargoLimitedUnits);
            }
            // Compute total volume
            const totalVolume = Math.floor(maxUnits * itemDetails.volume);

            // Determine origin/destination IDs and lookup info
            const originId = trade.origin_id ?? trade.from_location;
            const destId = trade.destination_id ?? trade.to_location;
            const originInfo = stationMap.get(originId) || structMap.get(originId) || {};
            const destInfo = stationMap.get(destId) || structMap.get(destId) || {};

            // Log missing structure IDs for debugging
            if (!originInfo.name) {
                console.warn(`Missing origin structure ID: ${originId}`);
            }
            if (!destInfo.name) {
                console.warn(`Missing destination structure ID: ${destId}`);
            }

            const originStationName = originInfo.name || `Unknown Station (ID: ${originId})`;
            const destinationStationName = destInfo.name || `Unknown Station (ID: ${destId})`;

            // Ensure player structures are displayed correctly
            const originIsNPC = originInfo.type === 'station' || originInfo.is_npc === 1;
            const destinationIsNPC = destInfo.type === 'station' || destInfo.is_npc === 1;

            // Calculate jumps between systems
            let jumps = 'N/A';
            if (originInfo.system_id && destInfo.system_id) {
                jumps = await calculateJumps(originInfo.system_id, destInfo.system_id);
            }

            transformedTrades.push({
                'Item': itemDetails.name,
                'From': {
                    name: originStationName,
                    security: originInfo.security_status ?? originInfo.security ?? null,
                    isNPC: originIsNPC,
                    systemId: originInfo.system_id
                },
                'To': {
                    name: destinationStationName,
                    security: destInfo.security_status ?? destInfo.security ?? null,
                    isNPC: destinationIsNPC,
                    systemId: destInfo.system_id
                },
                'Buy Price': trade.sell_price || 0,
                'Sell Price': trade.buy_price || 0,
                'Profit Per Unit': trade.profit_per_unit || 0,
                'Profit Percentage': trade.profit_margin || 0,
                'Quantity': maxUnits,
                'Total Volume (m3)': totalVolume,
                'Item Volume': itemDetails.volume,
                'Jumps': jumps,
                'Total Profit': (trade.profit_per_unit || 0) * maxUnits,
                '_rawData': trade
            });
        }

        return transformedTrades;
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value || (field === 'minProfit' ? '500000' : prev[field]), // Ensure default value for Min Profit
        }));
    };

    // Calculate sales tax based on Accounting skill level
    const calculateSalesTax = (skillLevel) => {
        const baseTax = 7.5;
        const reductionPerLevel = 0.11; // 11% reduction per level
        return Number((baseTax * (1 - (skillLevel * reductionPerLevel))).toFixed(3));
    };

    // Sales tax options based on Accounting skill levels
    const salesTaxOptions = [
        { level: 0, tax: 7.5, label: "No Skill: 7.5%" },
        { level: 1, tax: 6.675, label: "Lvl I: 6.675%" },
        { level: 2, tax: 5.85, label: "Lvl II: 5.85%" },
        { level: 3, tax: 5.025, label: "Lvl III: 5.025%" },
        { level: 4, tax: 4.2, label: "Lvl IV: 4.2%" },
        { level: 5, tax: 3.375, label: "Lvl V: 3.375%" }
    ];

    // Security status options
    const securityStatusOptions = [
        { value: 'any', label: 'Any' },
        { value: 'highsec', label: 'High-Sec' },
        { value: 'lowsec', label: 'Low-Sec' },
        { value: 'nullsec', label: 'Null-Sec' }
    ];

    // Structure type options
    const structureTypeOptions = [
        { value: 'both', label: 'Any' },
        { value: 'stations', label: 'NPC Stations' },
        { value: 'structures', label: 'Player Structures' }
    ];

    // Route preference options
    const routePreferenceOptions = [
        { value: 'safest', label: 'Safest Route' },
        { value: 'shortest', label: 'Shortest Route' }
    ];

    const handleFromRegionChange = (region) => {
        setFormData(prev => ({
            ...prev,
            fromRegion: region,
            // Reset nearby only if it was previously set
            nearbyOnly: prev.nearbyOnly && region ? prev.nearbyOnly : false
        }));
    };

    const handleToRegionChange = (region) => {
        setFormData(prev => ({
            ...prev,
            toRegion: region,
            nearbyOnly: false // Reset nearby only when manually selecting to region
        }));
    };

    // New function to fetch and process market orders
    const fetchAndProcessMarketOrders = async (fromRegionId, toRegionId, formData) => {
        try {
            // Fetch market orders from ESI
            const marketOrders = await fetchMarketOrders(fromRegionId, toRegionId);

            // Filter and process orders to find profitable trades
            const profitableTrades = marketOrders.filter(order => {
                const profit = order.sell_price - order.buy_price;
                const roi = (profit / order.buy_price) * 100;

                return (
                    profit >= parseFloat(formData.minProfit) &&
                    roi >= parseFloat(formData.minROI) &&
                    (!formData.maxBudget || order.buy_price <= parseFloat(formData.maxBudget))
                );
            });

            // Transform data for display
            return await transformApiResponseToDisplayFormat(profitableTrades, formData);
        } catch (error) {
            console.error('Error fetching or processing market orders:', error);
            throw new Error('Failed to fetch market orders.');
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setResults([]);
        setCurrentPage(1);
        setLoading(true);
        setError(null);
        setShowResults(false);

        if (!formData.fromRegion?.regionID || !formData.toRegion?.regionID) {
            setError('Please select both source and destination regions');
            setLoading(false);
            return;
        }

        try {
            const fromRegionId = formData.fromRegion.regionID;
            const toRegionId = formData.toRegion.regionID;

            // Fetch and process market orders
            const transformedData = await fetchAndProcessMarketOrders(fromRegionId, toRegionId, formData);

            if (transformedData.length > 0) {
                setResults(transformedData);
                setShowResults(true);
            } else {
                setError('No profitable trades found for the selected criteria.');
            }
        } catch (error) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    // Sorting handler
    const handleSort = (key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            return { key, direction: 'asc' };
        });
    };

    // Sorted results based on sort config
    const sortedResults = useMemo(() => {
        if (!sortConfig.key) return results;
        const sorted = [...results];
        sorted.sort((a, b) => {
            const getValue = (item, key) => {
                switch (key) {
                    case 'Item': return item.Item || '';
                    case 'From': return (item.From && item.From.name) || item.From || '';
                    case 'To': return (item.To && item.To.name) || item['Take To'] || '';
                    case 'Quantity': return item['Quantity'] || 0;
                    case 'Buy Price': return item['Buy Price'] || 0;
                    case 'Total Buy Price': return (item['Buy Price'] || 0) * (item['Quantity'] || 0);
                    case 'Sell Price': return item['Sell Price'] || 0;
                    case 'Net Profit': return item['Total Profit'] || 0;
                    case 'Jumps': return typeof item.Jumps === 'number' ? item.Jumps : 0;
                    case 'Profit per Jump': return typeof item.Jumps === 'number' && item['Total Profit'] ? item['Total Profit'] / item.Jumps : 0;
                    case 'Profit Per Item': return item['Profit Per Unit'] || 0;
                    case 'ROI': return item['Profit Percentage'] || 0;
                    case 'Total Volume (m³)': return item['Total Volume (m3)'] || 0;
                    default: return item[key] || '';
                }
            };
            const aVal = getValue(a, sortConfig.key);
            const bVal = getValue(b, sortConfig.key);
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
            }
            return sortConfig.direction === 'asc'
                ? String(aVal).localeCompare(String(bVal))
                : String(bVal).localeCompare(String(aVal));
        });
        return sorted;
    }, [results, sortConfig]);

    const clearResults = () => {
        setResults([]);
        setError(null);
        setCurrentPage(1);
        setUsingFallback(false);
        setShowResults(false);
    };

    if (!regionsData) {
        return (
            <div className="region-hauling">
                <div className="loading-container">
                    <p>Loading regions...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="region-hauling">
            <div className="static-header">
                {/* Pink area: Static header */}
                <div className="page-header">
                    <h1>Region to Region Trading</h1>
                    <p className="disclaimer">This feature is still a WIP and may have issues.</p>
                </div>
            </div>

            <div className="scrollable-content">
                {/* Red area: Scrollable content */}
                <div className="hauling-form">
                    <form onSubmit={handleSubmit}>
                        <div className="form-container">
                            <div
                                className="form-row form-row-main"
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    flexWrap: 'nowrap',
                                    gap: '20px',
                                    padding: '0 20px',
                                    overflowX: 'auto',
                                    margin: '0 auto 10px auto',
                                }}
                            >
                                <div className="form-group region-group">
                                    <label>Starting Region</label>
                                    <RegionSelector
                                        selectedRegion={formData.fromRegion}
                                        onRegionChange={handleFromRegionChange}
                                        allowAllRegions={false}
                                    />
                                </div>

                                <div className="form-group region-group">
                                    <label>Ending Region</label>
                                    {formData.nearbyOnly ? (
                                        <div className="nearby-region-display">…</div>
                                    ) : (
                                        <RegionSelector
                                            selectedRegion={formData.toRegion}
                                            onRegionChange={handleToRegionChange}
                                            allowAllRegions={false}
                                        />
                                    )}
                                </div>

                                <div className="form-group">
                                    <label>Security</label>
                                    <select
                                        value={formData.securityStatus}
                                        onChange={e => handleInputChange('securityStatus', e.target.value)}
                                        className="form-control"
                                        style={{ width: '115px' }}
                                    >
                                        {securityStatusOptions.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Stations/Structures</label>
                                    <select
                                        value={formData.structureType}
                                        onChange={e => handleInputChange('structureType', e.target.value)}
                                        className="form-control"
                                        style={{ width: '165px' }}
                                    >
                                        {structureTypeOptions.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Route</label>
                                    <select
                                        value={formData.routePreference}
                                        onChange={e => handleInputChange('routePreference', e.target.value)}
                                        className="form-control"
                                        style={{ width: '155px' }}
                                    >
                                        {routePreferenceOptions.map(o => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Max Jumps</label>
                                    <input
                                        type="number"
                                        value={formData.maxJumps}
                                        onChange={e => handleInputChange('maxJumps', e.target.value)}
                                        placeholder="∞"
                                        className="form-control"
                                        style={{ width: '80px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Max Budget</label>
                                    <input
                                        type="number"
                                        value={formData.maxBudget}
                                        onChange={e => handleInputChange('maxBudget', e.target.value)}
                                        placeholder="∞"
                                        className="form-control"
                                        style={{ width: '165px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Max Capacity (m³)</label>
                                    <input
                                        type="number"
                                        value={formData.maxWeight}
                                        onChange={e => handleInputChange('maxWeight', e.target.value)}
                                        placeholder="∞"
                                        className="form-control"
                                        style={{ width: '135px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Sales Tax</label>
                                    <select
                                        value={formData.salesTax}
                                        onChange={e => handleInputChange('salesTax', Number(e.target.value))}
                                        className="form-control"
                                        style={{ width: '155px' }}
                                    >
                                        {salesTaxOptions.map(o => (
                                            <option key={o.level} value={o.tax}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Min Profit</label>
                                    <input
                                        type="number"
                                        value={formData.minProfit}
                                        onChange={e => handleInputChange('minProfit', e.target.value)}
                                        className="form-control"
                                        style={{ width: '175px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Min ROI %</label>
                                    <input
                                        type="number"
                                        value={formData.minROI}
                                        onChange={e => handleInputChange('minROI', Number(e.target.value) || 0)}
                                        className="form-control"
                                        style={{ width: '100px' }}
                                    />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="error-message">
                                {error}
                            </div>
                        )}

                        <div className="form-actions">
                            <button
                                type="submit"
                                disabled={loading || !formData.fromRegion || !formData.toRegion}
                                className="submit-btn"
                            >
                                {loading ? 'Searching...' : 'Find Trade Routes'}
                            </button>
                        </div>
                    </form>
                </div>

                {showResults && sortedResults.length > 0 && (
                    <div className="results-container">
                        <div className="results-header">
                            <h2>Trade Route Results ({sortedResults.length} found)</h2>
                            {usingFallback && (
                                <div className="fallback-warning" style={{
                                    backgroundColor: '#fff3cd',
                                    border: '1px solid #ffeaa7',
                                    borderRadius: '4px',
                                    padding: '10px',
                                    margin: '10px 0',
                                    color: '#856404'
                                }}>
                                    ⚠️ Azure Functions unavailable. Using basic market data analysis. Results may be limited to common trade items.
                                </div>
                            )}
                            <button
                                onClick={clearResults}
                                className="new-search-btn"
                            >
                                Clear Results
                            </button>
                        </div>
                        <div className="results-table-container">
                            <table className="results-table wide-table">
                                <thead>
                                    <tr>
                                        <th onClick={() => handleSort('Item')}>Item{sortConfig.key === 'Item' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Quantity')}>Buy Quantity{sortConfig.key === 'Quantity' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Buy Price')}>Item Buy Price{sortConfig.key === 'Buy Price' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Total Buy Price')}>Total Buy Price{sortConfig.key === 'Total Buy Price' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('From')}>From{sortConfig.key === 'From' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('To')}>To{sortConfig.key === 'To' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Sell Price')}>Item Sell Price{sortConfig.key === 'Sell Price' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Net Profit')}>Net Profit{sortConfig.key === 'Net Profit' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Profit Per Item')}>Profit Per Item{sortConfig.key === 'Profit Per Item' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('ROI')}>ROI%{sortConfig.key === 'ROI' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Profit per Jump')}>Profit per Jump{sortConfig.key === 'Profit per Jump' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Jumps')}>Jumps{sortConfig.key === 'Jumps' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                        <th onClick={() => handleSort('Total Volume (m³)')}>Total Volume (m³){sortConfig.key === 'Total Volume (m³)' ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        // Calculate pagination
                                        const startIndex = (currentPage - 1) * itemsPerPage;
                                        const endIndex = startIndex + itemsPerPage;
                                        const paginatedResults = sortedResults.slice(startIndex, endIndex);

                                        return paginatedResults.map((result, index) => {
                                            // Extract values from the new data structure
                                            const item = result.Item || 'Unknown Item';
                                            const fromStation = result.From || {};
                                            const toStation = result['To'] || result['Take To'] || {};
                                            const buyPrice = result['Buy Price'] || 0;
                                            const sellPrice = result['Sell Price'] || 0;
                                            const profitPerUnit = result['Profit Per Unit'] || 0;
                                            const profitPercentage = result['Profit Percentage'] || 0;
                                            const totalProfit = result['Total Profit'] || 0;
                                            const quantity = result['Quantity'] || 0;
                                            const totalVolume = result['Total Volume (m3)'] || 0;
                                            const jumps = result.Jumps || 'N/A';
                                            // Calculate total buy price and profit per jump
                                            const totalBuyPrice = buyPrice * quantity;
                                            const profitPerJump = (typeof jumps === 'number' && jumps > 0)
                                                ? totalProfit / jumps
                                                : 0;

                                            // Render station names with security coloring and click-to-copy
                                            const renderStationName = (station) => {
                                                if (typeof station === 'string') {
                                                    return (
                                                        <span
                                                            className="clickable-location"
                                                            onClick={() => copyToClipboard(station)}
                                                            title="Click to copy to clipboard"
                                                        >
                                                            {station}
                                                        </span>
                                                    );
                                                }

                                                const stationName = station.name || 'Unknown Station';
                                                const security = station.security;
                                                const isNPC = station.isNPC;

                                                let color = '#ffffff'; // Default color
                                                if (security !== null && security !== undefined) {
                                                    color = getSecurityColor(security);
                                                }

                                                return (
                                                    <span
                                                        className="clickable-location"
                                                        style={{ color }}
                                                        onClick={() => copyToClipboard(stationName)}
                                                        title={`Security: ${security !== null && security !== undefined ? security.toFixed(1) : 'Unknown'} | ${isNPC ? 'NPC Station' : 'Player Structure'} | Click to copy`}
                                                    >
                                                        {stationName}
                                                    </span>
                                                );
                                            };

                                            return (
                                                <tr key={startIndex + index}>
                                                    <td>
                                                        <span
                                                            className="clickable-location"
                                                            onClick={() => copyToClipboard(item)}
                                                            title="Click to copy item name"
                                                        >
                                                            {item}
                                                        </span>
                                                    </td>
                                                    <td>{renderStationName(fromStation)}</td>
                                                    <td>{utils.formatNumber(quantity, 0)}</td>
                                                    <td>{utils.formatNumber(buyPrice)}</td>
                                                    <td>{utils.formatNumber(totalBuyPrice)}</td>
                                                    <td>{renderStationName(toStation)}</td>
                                                    <td>{utils.formatNumber(sellPrice)}</td>
                                                    <td>{utils.formatNumber(totalProfit)}</td>
                                                    <td>{jumps}</td>
                                                    <td>{utils.formatNumber(profitPerJump)}</td>
                                                    <td>{utils.formatNumber(profitPerUnit)}</td>
                                                    <td>{utils.formatNumber(profitPercentage, 1)}%</td>
                                                    <td>{utils.formatNumber(totalVolume, 0)}</td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {sortedResults.length > itemsPerPage && (
                            <div className="pagination-container">
                                <div className="pagination">
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                        disabled={currentPage === 1}
                                        className="pagination-btn"
                                    >
                                        Previous
                                    </button>

                                    <span className="pagination-info">
                                        Page {currentPage} of {Math.ceil(sortedResults.length / itemsPerPage)}
                                        ({sortedResults.length} total results)
                                    </span>

                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(sortedResults.length / itemsPerPage)))}
                                        disabled={currentPage >= Math.ceil(sortedResults.length / itemsPerPage)}
                                        className="pagination-btn"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div
                className="return-to-top"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                title="Return to Top"
            >
                ↑
            </div>
        </div>
    );
}