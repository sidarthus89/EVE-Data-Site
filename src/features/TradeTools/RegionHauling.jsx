// src/features/TradeTools/RegionHauling.jsx
import React, { useState, useEffect, useMemo } from 'react';
import RegionSelector from '../../components/RegionSelector/RegionSelector.jsx';
import { getSecurityColor, getStationInfo, getRegionInfo } from '../../utils/common.js';
import { fetchMarketOrders, fetchRegionHaulingSnapshotsOnly } from '../../utils/market.js';
import { fetchRegions, fetchStructures, fetchStationsNPC, fetchMarketTree, fetchRouteJumps, fetchDataLastCommitTime } from '../../utils/api.js';
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
    structureType: 'all',
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
    const [sortConfig, setSortConfig] = useState({ key: 'Net Profit', direction: 'desc' });
    const [showResults, setShowResults] = useState(false);
    // Timer state for "Time Since Last Update" based on GitHub data commits
    const [lastResultsAt, setLastResultsAt] = useState(null);
    const [nowTick, setNowTick] = useState(Date.now());
    // Track commit time at last successful search and whether newer data exists
    const [searchCommitAt, setSearchCommitAt] = useState(null);
    const [refreshAvailable, setRefreshAvailable] = useState(false);
    // Column widths for resizable headers (px)
    const [colWidths, setColWidths] = useState({
        'Item': 140,
        'From': 240,
        'Quantity': 110,
        'Buy Price': 130,
        'Total Buy Price': 140,
        'To': 240,
        'Sell Price': 140,
        'Net Profit': 140,
        'Jumps': 90,
        'Profit per Jump': 150,
        'Profit Per Item': 130,
        'ROI': 100,
        'Total Volume (m³)': 120,
    });

    const startResize = (key, startX, startWidth) => {
        const onMove = (e) => {
            const dx = (e.clientX || 0) - startX;
            setColWidths(prev => ({ ...prev, [key]: Math.max(60, Math.min(800, Math.round(startWidth + dx))) }));
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const HeaderCell = ({ label }) => {
        const width = colWidths[label] || 120;
        return (
            <th
                onClick={() => handleSort(label)}
                style={{ width, minWidth: width, maxWidth: width, position: 'relative' }}
            >
                {label}{sortConfig.key === label ? (sortConfig.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                <span
                    className="col-resizer"
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        startResize(label, e.clientX || 0, width);
                    }}
                    title="Drag to resize"
                />
            </th>
        );
    };

    const cellStyle = (label) => {
        const width = colWidths[label] || 120;
        return { width, minWidth: width, maxWidth: width };
    };

    // Fetch item details (volume and name) from precomputed market.json
    const fetchItemDetails = (() => {
        let cache = null;
        const buildIndex = (tree) => {
            const map = new Map();
            const walk = (node) => {
                if (!node || typeof node !== 'object') return;
                if (Array.isArray(node.items)) {
                    for (const it of node.items) {
                        const id = Number(it.typeID);
                        if (!map.has(id)) {
                            map.set(id, { name: it.typeName, volume: it.volume || 0.01 });
                        }
                    }
                }
                for (const k of Object.keys(node)) {
                    if (k !== 'items' && k !== '_info') walk(node[k]);
                }
            };
            walk(tree);
            return map;
        };
        return async (typeId) => {
            try {
                if (!cache) {
                    const tree = await fetchMarketTree();
                    cache = buildIndex(tree);
                }
                const rec = cache.get(Number(typeId));
                return { volume: rec?.volume || 0.01, name: rec?.name || `Item ${typeId}` };
            } catch {
                return { volume: 0.01, name: `Item ${typeId}` };
            }
        };
    })();

    // Calculate jumps between two systems using ESI route; tiny in-memory cache
    const jumpCache = React.useRef(new Map());
    const calculateJumps = async (fromSystemId, toSystemId) => {
        const key = `${fromSystemId}->${toSystemId}`;
        if (jumpCache.current.has(key)) return jumpCache.current.get(key);
        try {
            const hops = await fetchRouteJumps(fromSystemId, toSystemId);
            jumpCache.current.set(key, hops);
            return hops;
        } catch {
            jumpCache.current.set(key, null);
            return null;
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
        // Load static structure and station data for mapping (from /public/data)
        const [structures, stations] = await Promise.all([
            fetchStructures(),
            fetchStationsNPC()
        ]);
        const stationMap = new Map(stations.map(s => [Number(s.station_id || s.stationID), s]));
        const structMap = new Map(structures.map(s => [Number(s.structureID ?? s.stationID), s]));

        if (!apiData || !Array.isArray(apiData)) {
            return [];
        }

        // Get cargo capacity from form (convert to number, default to unlimited if not specified)
        const cargoCapacity = formData.maxWeight ? parseFloat(formData.maxWeight) : null;

        const transformedTrades = [];

        for (const trade of apiData) {

            // Get item details (volume and name) from ESI
            const itemDetails = await fetchItemDetails(trade.type_id);

            // Calculate maximum units considering cargo capacity and budget
            let maxUnits = trade.max_volume || 0; // available tradable units
            if (cargoCapacity && itemDetails.volume > 0) {
                const cargoLimitedUnits = Math.floor(cargoCapacity / itemDetails.volume);
                maxUnits = Math.min(maxUnits, cargoLimitedUnits);
            }
            if (formData.maxBudget) {
                const budget = Number(formData.maxBudget) || 0;
                const unitPrice = Number(trade.sell_price || 0);
                if (unitPrice > 0) {
                    const budgetLimitedUnits = Math.floor(budget / unitPrice);
                    maxUnits = Math.min(maxUnits, budgetLimitedUnits);
                }
            }
            // Compute total volume
            const totalVolume = Math.floor((maxUnits || 0) * (itemDetails.volume || 0));

            // Use enhanced data directly from the API if available
            // If not, fall back to local lookup methods
            let originStationName, destinationStationName, originIsNPC, destinationIsNPC, jumps;
            // Ensure info objects are declared in outer scope for later use
            let originInfo = null, destInfo = null;

            // Use the enhanced data from our API if available
            if (trade.origin_name && trade.destination_name) {
                originStationName = trade.origin_name;
                destinationStationName = trade.destination_name;
                originIsNPC = (trade.origin_is_npc ?? true) === true;
                destinationIsNPC = (trade.destination_is_npc ?? true) === true;
                jumps = trade.jumps ?? 'N/A';
            } else {
                // Fall back to local lookup for older API responses
                const originId = trade.origin_id ?? trade.from_location ?? trade.source_station_id;
                const destId = trade.destination_id ?? trade.to_location ?? trade.destination_station_id;
                originInfo = stationMap.get(originId) || structMap.get(originId) || {};
                destInfo = stationMap.get(destId) || structMap.get(destId) || {};

                // Log missing structure IDs for debugging
                if (!originInfo.name) {
                    console.warn(`Missing origin structure ID: ${originId}`);
                }
                if (!destInfo.name) {
                    console.warn(`Missing destination structure ID: ${destId}`);
                }

                originStationName = originInfo.name || `Unknown Station (ID: ${originId})`;
                destinationStationName = destInfo.name || `Unknown Station (ID: ${destId})`;

                // Ensure player structures are displayed correctly; default unknown to NPC (true)
                const originIsNpcComputed = originInfo && (originInfo.type === 'station' || originInfo.is_npc === 1 || originInfo.is_npc === true);
                const destIsNpcComputed = destInfo && (destInfo.type === 'station' || destInfo.is_npc === 1 || destInfo.is_npc === true);
                originIsNPC = originIsNpcComputed === undefined ? true : !!originIsNpcComputed;
                destinationIsNPC = destIsNpcComputed === undefined ? true : !!destIsNpcComputed;

                // Calculate jumps between systems
                jumps = null;
                const fromSystemId = trade.origin_system_id || originInfo?.system_id || originInfo?.systemID || originInfo?.solarSystemID;
                const toSystemId = trade.destination_system_id || destInfo?.system_id || destInfo?.systemID || destInfo?.solarSystemID;
                if (fromSystemId && toSystemId) {
                    jumps = await calculateJumps(fromSystemId, toSystemId);
                }
            }

            // Get the security status data
            let originSecurity = trade.origin_security ?? (originInfo ? (originInfo.security_status ?? originInfo.security ?? null) : null);
            let destSecurity = trade.destination_security ?? (destInfo ? (destInfo.security_status ?? destInfo.security ?? null) : null);
            // Coerce to numbers when possible
            originSecurity = (originSecurity !== null && originSecurity !== undefined) ? Number(originSecurity) : originSecurity;
            destSecurity = (destSecurity !== null && destSecurity !== undefined) ? Number(destSecurity) : destSecurity;

            // Calculate profit per jump
            const profitPerJump = trade.profit_per_jump ?? (jumps && typeof jumps === 'number' && jumps > 0 ?
                ((trade.profit_per_unit || 0) * maxUnits) / jumps : null);

            transformedTrades.push({
                'Item': trade.name || itemDetails.name,
                'From': {
                    name: originStationName,
                    security: originSecurity,
                    isNPC: originIsNPC,
                    systemId: trade.origin_system_id || (originInfo ? originInfo.system_id : null)
                },
                'To': {
                    name: destinationStationName,
                    security: destSecurity,
                    isNPC: destinationIsNPC,
                    systemId: trade.destination_system_id || (destInfo ? destInfo.system_id : null)
                },
                'Buy Price': trade.sell_price || 0,
                'Sell Price': trade.buy_price || 0,
                'Profit Per Unit': trade.profit_per_unit || 0,
                'Profit Percentage': trade.profit_margin || 0,
                'Quantity': maxUnits,
                'Total Volume (m3)': totalVolume,
                'Item Volume': trade.volume || itemDetails.volume,
                'Jumps': jumps,
                'Profit per Jump': profitPerJump,
                'Total Profit': trade.total_profit || ((trade.profit_per_unit || 0) * maxUnits),
                'ROI': trade.profit_margin,
                '_rawData': trade
            });
        }

        // Apply post-transform filters
        let finalTrades = transformedTrades;

        // Drop rows that end up with zero quantity after budget/capacity limits
        finalTrades = finalTrades.filter(t => (Number(t['Quantity']) || 0) > 0);

        // Re-apply Budget / Min Profit / ROI filters using computed quantities
        const minProfitFilter = parseFloat(formData.minProfit || '0');
        const minRoiFilter = parseFloat(formData.minROI || '0');
        const maxBudgetFilter = formData.maxBudget ? parseFloat(formData.maxBudget) : null;

        finalTrades = finalTrades.filter(t => {
            const qty = Number(t['Quantity']) || 0;
            const buyPrice = Number(t['Buy Price']) || 0;
            const totalBuy = buyPrice * qty;
            const totalProfit = Number(t['Total Profit']) || 0;
            const roiPct = Number(t['Profit Percentage']) || 0;

            const meetsBudget = maxBudgetFilter == null || totalBuy <= maxBudgetFilter;
            const meetsProfit = totalProfit >= minProfitFilter;
            const meetsRoi = roiPct >= minRoiFilter;
            return meetsBudget && meetsProfit && meetsRoi;
        });
        // Security filter
        if (formData.securityStatus && formData.securityStatus !== 'any') {
            const isHigh = s => typeof s === 'number' && s >= 0.5;
            const isLow = s => typeof s === 'number' && s > 0 && s < 0.5;
            const isNull = s => typeof s === 'number' && s <= 0;
            finalTrades = finalTrades.filter(t => {
                const os = t.From?.security;
                const ds = t.To?.security;
                if (os == null || ds == null) return false;
                if (formData.securityStatus === 'highsec') return isHigh(os) && isHigh(ds);
                if (formData.securityStatus === 'lowsec') return isLow(os) && isLow(ds);
                if (formData.securityStatus === 'nullsec') return isNull(os) && isNull(ds);
                return true;
            });
        }
        // Structure type filter
        if (formData.structureType && formData.structureType !== 'all') {
            finalTrades = finalTrades.filter(t => {
                const oNpc = t.From?.isNPC === true;
                const dNpc = t.To?.isNPC === true;
                if (formData.structureType === 'avoid-player') return oNpc && dNpc; // NPC-only
                if (formData.structureType === 'avoid-npc') return !oNpc && !dNpc; // Player-only
                return true;
            });
        }
        // Max jumps filter
        if (formData.maxJumps) {
            const maxJumps = Number(formData.maxJumps);
            if (Number.isFinite(maxJumps)) {
                finalTrades = finalTrades.filter(t => typeof t.Jumps === 'number' ? t.Jumps <= maxJumps : true);
            }
        }
        return finalTrades;
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value,
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
        { value: 'all', label: 'All' },
        { value: 'avoid-player', label: 'Avoid Player Structures' },
        { value: 'avoid-npc', label: 'Avoid NPC Stations' }
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

    // New function to fetch and process market orders (snapshots only)
    const fetchAndProcessMarketOrders = async (fromRegionId, toRegionId, formData) => {
        try {
            // Use only GitHub snapshots: derive from region_orders (no region_hauling artifacts)
            const regionHaulingData = await fetchRegionHaulingSnapshotsOnly(fromRegionId, toRegionId);

            // Filter and process orders to find profitable trades
            const profitableTrades = regionHaulingData.filter(route => {
                // Prefer total profit when available; fall back to unit profit * quantity
                const unitProfit = (route.profit_per_unit ?? (route.buy_price - route.sell_price) ?? 0);
                const quantity = (route.max_volume ?? 0);
                const totalProfit = (route.total_profit ?? (unitProfit * quantity));

                const roi = (route.profit_margin ?? (
                    route.sell_price ? ((unitProfit / route.sell_price) * 100) : 0
                ));

                const meetsProfit = totalProfit >= parseFloat(formData.minProfit || 0);

                // If budget is provided, approximate total buy cost as unit price * quantity
                const totalBuyCost = (route.sell_price ?? 0) * quantity;
                const meetsBudget = !formData.maxBudget || totalBuyCost <= parseFloat(formData.maxBudget);

                return meetsProfit && (roi >= parseFloat(formData.minROI || 0)) && meetsBudget;
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
            const fromRegionId = Number(formData.fromRegion.regionID);
            const toRegionId = Number(formData.toRegion.regionID);

            console.log(`🚛 Searching for trade routes from ${formData.fromRegion.regionName} (${fromRegionId}) to ${formData.toRegion.regionName} (${toRegionId})`);

            // Fetch and process market orders
            const transformedData = await fetchAndProcessMarketOrders(fromRegionId, toRegionId, formData);

            if (transformedData.length > 0) {
                setResults(transformedData);
                // Show banner only when routes were derived from snapshots (not precomputed)
                setUsingFallback(transformedData.some(r => r._rawData && r._rawData._fallback));
                setShowResults(true);
                if (lastResultsAt) setSearchCommitAt(lastResultsAt);
            } else {
                setError('No profitable trades found for the selected criteria.');
            }
        } catch (error) {
            setError(error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        if (loading || !formData.fromRegion?.regionID || !formData.toRegion?.regionID) return;
        setLoading(true);
        setError(null);
        try {
            const fromRegionId = Number(formData.fromRegion.regionID);
            const toRegionId = Number(formData.toRegion.regionID);
            const transformedData = await fetchAndProcessMarketOrders(fromRegionId, toRegionId, formData);
            if (transformedData.length > 0) {
                setResults(transformedData);
                setUsingFallback(transformedData.some(r => r._rawData && r._rawData._fallback));
                setShowResults(true);
                if (lastResultsAt) setSearchCommitAt(lastResultsAt);
            } else {
                setError('No profitable trades found for the refreshed data.');
            }
        } catch (err) {
            setError(err.message || 'Failed to refresh results');
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
        // Do not reset lastResultsAt; it reflects GitHub data/ last commit, not search time
    };

    // On mount, fetch last commit time for data/ and refresh it periodically; tick every second for display
    useEffect(() => {
        let mounted = true;
        const fetchCommit = async () => {
            try {
                const iso = await fetchDataLastCommitTime();
                if (mounted && iso) setLastResultsAt(new Date(iso).getTime());
            } catch { /* noop */ }
        };
        // Initial fetch
        fetchCommit();
        // Refresh every 60s to capture new publishes while page is open
        const refreshId = setInterval(fetchCommit, 60_000);
        // UI tick every second
        const uiTickId = setInterval(() => setNowTick(Date.now()), 1_000);
        return () => { mounted = false; clearInterval(refreshId); clearInterval(uiTickId); };
    }, []);

    // Detect new data availability
    useEffect(() => {
        if (searchCommitAt && lastResultsAt && lastResultsAt > searchCommitAt) {
            setRefreshAvailable(true);
        } else {
            setRefreshAvailable(false);
        }
    }, [lastResultsAt, searchCommitAt]);

    const renderSinceLastUpdate = () => {
        if (!lastResultsAt) return '—';
        const diffMs = Math.max(0, nowTick - lastResultsAt);
        const minutes = Math.floor(diffMs / 60000);
        const seconds = Math.floor((diffMs % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
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
                            <div className="form-row form-row-main responsive-row">
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
                                        value={formData.maxJumps ?? ''}
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
                                        value={formData.maxBudget ?? ''}
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
                                        value={formData.maxWeight ?? ''}
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
                                        value={formData.minProfit ?? ''}
                                        onChange={e => handleInputChange('minProfit', e.target.value)}
                                        placeholder="0"
                                        className="form-control"
                                        style={{ width: '175px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Min ROI %</label>
                                    <input
                                        type="number"
                                        value={formData.minROI ?? ''}
                                        onChange={e => handleInputChange('minROI', e.target.value)}
                                        placeholder="0"
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
                            <div className="primary-actions">
                                <div className="buttons-row">
                                    <button
                                        type="submit"
                                        disabled={loading || !formData.fromRegion || !formData.toRegion}
                                        className="eve-button primary-search-btn"
                                    >
                                        {loading ? 'Searching...' : 'Find Trade Routes'}
                                    </button>
                                    {refreshAvailable && showResults && (
                                        <button
                                            type="button"
                                            onClick={handleRefresh}
                                            disabled={loading}
                                            className="eve-button refresh-btn"
                                            title="New data is available. Click to refresh results."
                                        >
                                            {loading ? 'Refreshing…' : 'New Data Available – Refresh'}
                                        </button>
                                    )}
                                </div>
                                <div
                                    className="update-timer-container"
                                    title={lastResultsAt ? new Date(lastResultsAt).toLocaleString() : ''}
                                >
                                    <span className="update-timer-label">Time Since Last Update:</span>
                                    <span className="update-timer-value">{renderSinceLastUpdate()}</span>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>

                {showResults && sortedResults.length > 0 && (
                    <div className="results-container">
                        <div className="results-header">
                            <h2>Trade Route Results ({sortedResults.length} found)</h2>
                            <button
                                onClick={clearResults}
                                className="eve-button clear-results-btn"
                                type="button"
                            >
                                Clear Results
                            </button>
                        </div>
                        <div className="results-table-container">
                            <table className="results-table wide-table">
                                <thead>
                                    <tr>
                                        <HeaderCell label="Item" />
                                        <HeaderCell label="From" />
                                        <HeaderCell label="Quantity" />
                                        <HeaderCell label="Buy Price" />
                                        <HeaderCell label="Total Buy Price" />
                                        <HeaderCell label="To" />
                                        <HeaderCell label="Sell Price" />
                                        <HeaderCell label="Net Profit" />
                                        <HeaderCell label="Jumps" />
                                        <HeaderCell label="Profit per Jump" />
                                        <HeaderCell label="Profit Per Item" />
                                        <HeaderCell label="ROI" />
                                        <HeaderCell label="Total Volume (m³)" />
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
                                            const buyPrice = result['Buy Price'