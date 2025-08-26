// src/features/TradeTools/RegionHauling.jsx
import React, { useState, useEffect, useMemo } from 'react';
import RegionSelector from '../../components/RegionSelector/RegionSelector.jsx';
import { getSecurityColor, getStationInfo, getRegionInfo } from '../../utils/common.js';
import { fetchMarketOrders, fetchRegionHaulingData } from '../../utils/market.js';
import { fetchRegions } from '../../utils/api.js';
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
    minProfit: '',
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

    // Fast region loading using same system as Market.jsx
    useEffect(() => {
        console.log('🚛 Loading regions...');
        fetchRegions()
            .then(regions => {
                console.log('🚛 ✅ Regions loaded:', regions.length);
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
            // For now, we'll disable nearby regions feature since we removed EVE-Trade dependency
            // Could be enhanced later with static nearby region data
            console.log('🚛 Nearby regions feature disabled (EVE-Trade dependency removed)');
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
    }, [formData.nearbyOnly, nearbyRegions]);    // Fetch live market data for trade route analysis
    const fetchTradeRouteData = async (fromRegionId, toRegionId, itemTypes = [34, 44992]) => {
        console.log('🚛 Fetching live market data for trade routes...');

        const tradeOpportunities = [];

        for (const typeId of itemTypes) {
            try {
                // Fetch orders from Azure Functions
                const destResult = await fetchMarketOrders(typeId, toRegionId, null, true);
                const buyOrders = destResult.buyOrders || [];
                const srcResult = await fetchMarketOrders(typeId, fromRegionId, null, false);
                const sellOrders = srcResult.sellOrders || [];

                if (buyOrders.length > 0 && sellOrders.length > 0) {
                    // Find best prices
                    const bestBuyPrice = Math.max(...buyOrders.map(order => order.price));
                    const bestSellPrice = Math.min(...sellOrders.map(order => order.price));

                    if (bestBuyPrice > bestSellPrice) {
                        const profit = bestBuyPrice - bestSellPrice;
                        const profitPercent = (profit / bestSellPrice) * 100;

                        // Get volumes
                        const maxBuyVolume = buyOrders.find(o => o.price === bestBuyPrice)?.volume_remain || 0;
                        const maxSellVolume = sellOrders.find(o => o.price === bestSellPrice)?.volume_remain || 0;

                        tradeOpportunities.push({
                            type_id: typeId,
                            buy_price: bestSellPrice,
                            sell_price: bestBuyPrice,
                            profit_per_unit: profit,
                            profit_percentage: profitPercent,
                            max_volume: Math.min(maxBuyVolume, maxSellVolume),
                            from_location: fromRegionId,
                            to_location: toRegionId,
                            jumps: 'N/A' // Could be calculated with route data
                        });
                    }
                }
            } catch (error) {
                console.warn(`🚛 Failed to fetch market data for type ${typeId}:`, error);
            }
        }

        return tradeOpportunities.sort((a, b) => b.profit_percentage - a.profit_percentage);
    };

    // Data transformation function to convert API/market data to display format
    const transformApiResponseToDisplayFormat = async (apiData, formData) => {
        console.log('🚛 Transforming API data:', apiData);

        if (!apiData || !Array.isArray(apiData)) {
            console.log('🚛 Invalid API data for transformation');
            return [];
        }

        // Item volume data (m3 per unit)
        const itemVolumes = {
            34: 0.01,     // Tritanium
            35: 0.01,     // Pyerite
            36: 0.01,     // Mexallon
            37: 0.01,     // Isogen
            38: 0.01,     // Nocxium
            39: 0.01,     // Zydrine
            40: 0.01,     // Megacyte
            44992: 0.01,  // PLEX
            11399: 0.01,  // Morphite
            16634: 0.01,  // Crystalline Carbonide
            16640: 0.01,  // Titanium Carbide
            16643: 0.01,  // Tungsten Carbide
            16647: 0.01,  // Vanadium Carbide
            16648: 0.01,  // Scandium
            16649: 0.01,  // Chromium
            16650: 0.01,  // Hafnium
            16651: 0.01,  // Platinum
            16652: 0.01,  // Cobalt
            16653: 0.01,  // Cadmium
            11382: 0.01,  // Oxygen
            3683: 0.1,    // Oxygen Isotopes
            3684: 0.1,    // Nitrogen Isotopes
            3685: 0.1,    // Hydrogen Isotopes
            3686: 0.1,    // Helium Isotopes
            29668: 0.01,  // Skill Injector
            40519: 0.01,  // Skill Extractor
        };

        const getItemName = (typeId, fallbackName = null) => {
            const basicTypes = {
                34: 'Tritanium',
                35: 'Pyerite',
                36: 'Mexallon',
                37: 'Isogen',
                38: 'Nocxium',
                39: 'Zydrine',
                40: 'Megacyte',
                44992: 'PLEX',
                11399: 'Morphite',
                16634: 'Crystalline Carbonide',
                16640: 'Titanium Carbide',
                16643: 'Tungsten Carbide',
                16647: 'Vanadium Carbide',
                16648: 'Scandium',
                16649: 'Chromium',
                16650: 'Hafnium',
                16651: 'Platinum',
                16652: 'Cobalt',
                16653: 'Cadmium',
                11382: 'Oxygen',
                3683: 'Oxygen Isotopes',
                3684: 'Nitrogen Isotopes',
                3685: 'Hydrogen Isotopes',
                3686: 'Helium Isotopes',
                29668: 'Skill Injector',
                40519: 'Skill Extractor',
            };
            return fallbackName || basicTypes[typeId] || `Item ${typeId}`;
        };

        // Get cargo capacity from form (convert to number, default to unlimited if not specified)
        const cargoCapacity = formData.maxWeight ? parseFloat(formData.maxWeight) : null;

        return apiData.map((trade, index) => {
            console.log(`🚛 Transforming trade ${index}:`, trade);

            // Get item volume
            const itemVolume = trade.item_volume || itemVolumes[trade.type_id] || 0.01;

            // Calculate maximum units that can fit in cargo hold
            let maxUnits = trade.max_volume || 0;
            if (cargoCapacity && itemVolume > 0) {
                const cargoLimitedUnits = Math.floor(cargoCapacity / itemVolume);
                maxUnits = Math.min(maxUnits, cargoLimitedUnits);
            }

            // Create station name components with security coloring
            const originStationName = trade.origin_station_name || 'Unknown Station';
            const destinationStationName = trade.destination_station_name || 'Unknown Station';
            const originSecurity = trade.origin_security;
            const destinationSecurity = trade.destination_security;

            return {
                'Item': getItemName(trade.type_id, trade.item_name),
                'From': {
                    name: originStationName,
                    security: originSecurity,
                    isNPC: trade.origin_is_npc
                },
                'Take To': {
                    name: destinationStationName,
                    security: destinationSecurity,
                    isNPC: trade.destination_is_npc
                },
                'Buy Price': trade.sell_price || 0,
                'Sell Price': trade.buy_price || 0,
                'Profit Per Unit': trade.profit_per_unit || 0,
                'Profit Percentage': trade.profit_margin || 0,
                'Max Units': maxUnits,
                'Item Volume': itemVolume,
                'Jumps': 'N/A', // Azure function doesn't provide jump data
                '_rawData': trade // Keep original data for debugging
            };
        })
            .filter(trade => {
                // Apply cargo capacity filter - only show routes where we can carry at least some items
                return trade['Max Units'] > 0;
            });
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    // Function to scroll to results
    const scrollToResults = () => {
        setTimeout(() => {
            const resultsElement = document.getElementById('results-section');
            if (resultsElement) {
                const yOffset = -60; // Offset for any fixed headers
                const y = resultsElement.getBoundingClientRect().top + window.pageYOffset + yOffset;
                window.scrollTo({ top: y, behavior: 'smooth' });
                console.log('🚛 Scrolling to results section');
            } else {
                console.warn('🚛 Results section not found for scrolling');
            }
        }, 200); // Increased delay to ensure DOM is updated
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
        { value: 'both', label: 'Both' },
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log('🚛 Form submitted - starting fresh search');

        // Reset state for new search
        setResults([]);
        setCurrentPage(1);
        setLoading(true);
        setError(null);
        setUsingFallback(false);

        // Debug form data
        console.log('🚛 Current form data:', formData);
        console.log('🚛 From region:', formData.fromRegion);
        console.log('🚛 To region:', formData.toRegion);

        if (!formData.fromRegion?.regionID || !formData.toRegion?.regionID) {
            setError('Please select both source and destination regions');
            setLoading(false);
            return;
        }

        try {
            console.log('🚛 Fetching region hauling data from Azure Functions...');

            const fromRegionId = formData.fromRegion.regionID;
            const toRegionId = formData.toRegion.regionID;

            console.log(`🚛 Analyzing trade routes from region ${fromRegionId} to ${toRegionId}`);

            // Use Azure Function for region hauling data
            let tradesData = await fetchRegionHaulingData(fromRegionId, toRegionId);

            console.log('🚛 Azure Function result:', tradesData);

            // Apply user filters to the results
            if (formData.minProfit) {
                const minProfitValue = parseFloat(formData.minProfit);
                tradesData = tradesData.filter(trade => trade.profit_per_unit >= minProfitValue);
            }

            if (formData.minROI) {
                const minROIValue = parseFloat(formData.minROI);
                tradesData = tradesData.filter(trade => trade.profit_margin >= minROIValue);
            }

            console.log('🚛 Filtered trade data:', tradesData);

            // Check if we're using fallback data
            const isFallback = tradesData.length > 0 && tradesData[0]._fallback;
            setUsingFallback(isFallback);

            if (isFallback) {
                console.log('🚛 Using fallback data due to Azure Functions unavailability');
            }

            // Transform API data to display format
            const transformedData = await transformApiResponseToDisplayFormat(tradesData, formData);
            console.log('🚛 Transformed data for display:', transformedData);

            if (transformedData && transformedData.length > 0) {
                setResults(transformedData);
                setError(null);
                console.log('🚛 Results set successfully, count:', transformedData.length);
            } else {
                console.log('🚛 No valid data after transformation');
                setResults([]);
                setError('No trade routes found for the selected criteria');
            }
            setLoading(false);

            // Scroll to results with better timing
            setTimeout(() => {
                console.log('🚛 Attempting to scroll to results...');
                const resultsElement = document.getElementById('results-section');
                if (resultsElement) {
                    const rect = resultsElement.getBoundingClientRect();
                    const scrollTop = window.pageYOffset + rect.top - 100;
                    console.log('🚛 Scrolling to position:', scrollTop);
                    window.scrollTo({ top: scrollTop, behavior: 'smooth' });
                } else {
                    console.log('🚛 Results element not found - looking for alternative...');
                    const alternative = document.querySelector('.results-container');
                    if (alternative) {
                        console.log('🚛 Using alternative selector');
                        alternative.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }
            }, 200);

        } catch (error) {
            console.error('🚛 API Error:', error);
            setError(error.message || 'Failed to fetch trade routes');
            setResults([]);
            setLoading(false);
        }
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
            <div className="page-header">
                <h1>Region to Region Trading</h1>
                <p>Find the most profitable trade routes between regions.</p>
                <p className="disclaimer">Orders change frequently. Profit is not guaranteed. Verify prices are accurate.</p>
            </div>

            {/* Always show the form */}
            <div className="hauling-form">
                <form onSubmit={handleSubmit}>
                    <div className="form-row region-selector-row">
                        <div className="form-group">
                            <label>Starting Region</label>
                            <RegionSelector
                                selectedRegion={formData.fromRegion}
                                onRegionChange={handleFromRegionChange}
                                allowAllRegions={false}
                            />
                        </div>

                        <div className="form-group">
                            <label>Ending Region</label>
                            {formData.nearbyOnly ? (
                                <div className="nearby-region-display">
                                    <div className="nearby-region-info">
                                        <span className="nearby-count">
                                            {nearbyRegions.length} Nearby Regions
                                        </span>
                                        <div className="nearby-list">
                                            <small>Includes: {nearbyRegions.join(', ')}</small>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <RegionSelector
                                    selectedRegion={formData.toRegion}
                                    onRegionChange={handleToRegionChange}
                                    allowAllRegions={false}
                                />
                            )}
                        </div>
                    </div>

                    {/* Nearby regions feature hidden due to CORS issues with EVE-Trade API
                        <div className="form-row">
                            <div className="form-group checkbox-group">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={formData.nearbyOnly}
                                        onChange={(e) => handleInputChange('nearbyOnly', e.target.checked)}
                                        disabled={true}
                                    />
                                    Only show routes with nearby regions (temporarily disabled)
                                </label>
                            </div>
                        </div>
                        */}

                    <div className="form-row form-row-main">
                        <div className="form-group form-group-wide">
                            <label htmlFor="minProfit">Only Profit Above</label>
                            <input
                                id="minProfit"
                                type="number"
                                value={formData.minProfit}
                                onChange={(e) => handleInputChange('minProfit', e.target.value)}
                                placeholder="Default: 500,000"
                                className="form-control"
                            />
                        </div>

                        <div className="form-group form-group-narrow">
                            <label htmlFor="minROI">ROI %</label>
                            <input
                                id="minROI"
                                type="number"
                                value={formData.minROI}
                                onChange={(e) => handleInputChange('minROI', Number(e.target.value) || 0)}
                                className="form-control"
                            />
                        </div>

                        <div className="form-group form-group-wide">
                            <label htmlFor="maxBudget">Budget</label>
                            <input
                                id="maxBudget"
                                type="number"
                                value={formData.maxBudget}
                                onChange={(e) => handleInputChange('maxBudget', e.target.value)}
                                placeholder="Default: No Limit"
                                className="form-control"
                            />
                        </div>

                        <div className="form-group form-group-wide">
                            <label htmlFor="salesTax">Sales Tax</label>
                            <select
                                id="salesTax"
                                value={formData.salesTax}
                                onChange={(e) => handleInputChange('salesTax', Number(e.target.value))}
                                className="form-control"
                            >
                                {salesTaxOptions.map((option) => (
                                    <option key={option.level} value={option.tax}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group form-group-wide">
                            <label htmlFor="maxWeight">Cargo Capacity</label>
                            <input
                                id="maxWeight"
                                type="number"
                                value={formData.maxWeight}
                                onChange={(e) => handleInputChange('maxWeight', e.target.value)}
                                placeholder="Default: No Limit"
                                className="form-control"
                            />
                        </div>
                    </div>

                    <div className="form-row form-row-secondary">
                        <div className="form-group form-group-medium">
                            <label htmlFor="securityStatus">Security Status</label>
                            <select
                                id="securityStatus"
                                value={formData.securityStatus}
                                onChange={(e) => handleInputChange('securityStatus', e.target.value)}
                                className="form-control"
                            >
                                {securityStatusOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group form-group-medium">
                            <label htmlFor="routePreference">Route Preference</label>
                            <select
                                id="routePreference"
                                value={formData.routePreference}
                                onChange={(e) => handleInputChange('routePreference', e.target.value)}
                                className="form-control"
                            >
                                {routePreferenceOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group form-group-medium">
                            <label htmlFor="maxJumps">Max Jumps</label>
                            <input
                                id="maxJumps"
                                type="number"
                                value={formData.maxJumps}
                                onChange={(e) => handleInputChange('maxJumps', e.target.value)}
                                placeholder="Default: No Limit"
                                className="form-control"
                            />
                        </div>

                        <div className="form-group form-group-medium">
                            <label htmlFor="structureType">Structures</label>
                            <select
                                id="structureType"
                                value={formData.structureType}
                                onChange={(e) => handleInputChange('structureType', e.target.value)}
                                className="form-control"
                            >
                                {structureTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
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
                            onClick={() => {
                                console.log('🚛 Submit button clicked');
                                console.log('🚛 Loading state:', loading);
                                console.log('🚛 Form valid:', !(!formData.fromRegion || !formData.toRegion));
                            }}
                        >
                            {loading ? 'Searching...' : 'Find Trade Routes'}
                        </button>
                    </div>
                </form>
            </div>

            {/* Results section - show if we have results */}
            {results.length > 0 && (
                <div id="results-section" className="results-container">
                    <div className="results-header">
                        <h2>Trade Route Results ({results.length} found)</h2>
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
                            onClick={() => {
                                setResults([]);
                                setError(null);
                                setCurrentPage(1);
                                setUsingFallback(false);
                            }}
                            className="new-search-btn"
                        >
                            Clear Results
                        </button>
                    </div>
                    <div className="results-table-container">
                        <table className="results-table">
                            <thead>
                                <tr>
                                    <th>Item</th>
                                    <th>From Station</th>
                                    <th>To Station</th>
                                    <th>Buy Price</th>
                                    <th>Sell Price</th>
                                    <th>Profit Per Unit</th>
                                    <th>Profit %</th>
                                    <th>Max Units</th>
                                    <th>Jumps</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    // Calculate pagination
                                    const startIndex = (currentPage - 1) * itemsPerPage;
                                    const endIndex = startIndex + itemsPerPage;
                                    const paginatedResults = results.slice(startIndex, endIndex);

                                    return paginatedResults.map((result, index) => {
                                        // Debug: Log the structure of each result object
                                        if (index === 0 && currentPage === 1) {
                                            console.log('🚛 First result object keys:', Object.keys(result));
                                            console.log('🚛 First result object:', result);
                                        }

                                        // Extract values from the new data structure
                                        const item = result.Item || 'Unknown Item';
                                        const fromStation = result.From || {};
                                        const toStation = result['Take To'] || {};
                                        const buyPrice = result['Buy Price'] || 0;
                                        const sellPrice = result['Sell Price'] || 0;
                                        const profitPerUnit = result['Profit Per Unit'] || 0;
                                        const profitPercentage = result['Profit Percentage'] || 0;
                                        const maxUnits = result['Max Units'] || 0;
                                        const jumps = result.Jumps || 'N/A';

                                        // Render station names with security coloring
                                        const renderStationName = (station) => {
                                            if (typeof station === 'string') {
                                                return <span>{station}</span>;
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
                                                    style={{ color }}
                                                    title={`Security: ${security !== null ? security.toFixed(1) : 'Unknown'} | ${isNPC ? 'NPC Station' : 'Player Structure'}`}
                                                >
                                                    {stationName}
                                                </span>
                                            );
                                        };

                                        return (
                                            <tr key={startIndex + index}>
                                                <td>{item}</td>
                                                <td>{renderStationName(fromStation)}</td>
                                                <td>{renderStationName(toStation)}</td>
                                                <td>{utils.formatNumber(buyPrice)}</td>
                                                <td>{utils.formatNumber(sellPrice)}</td>
                                                <td>{utils.formatNumber(profitPerUnit)}</td>
                                                <td>{utils.formatNumber(profitPercentage, 1)}%</td>
                                                <td>{utils.formatNumber(maxUnits, 0)}</td>
                                                <td>{jumps}</td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {results.length > itemsPerPage && (
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
                                    Page {currentPage} of {Math.ceil(results.length / itemsPerPage)}
                                    ({results.length} total results)
                                </span>

                                <button
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil(results.length / itemsPerPage)))}
                                    disabled={currentPage >= Math.ceil(results.length / itemsPerPage)}
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
    );
}