// src/features/TradeTools/RegionHauling.jsx
import React, { useState, useEffect, useMemo } from 'react';
import RegionSelector from '../../components/RegionSelector/RegionSelector.jsx';
import { getSecurityColor, getStationInfo, getRegionInfo } from '../../utils/common.js';
import { fetchMarketOrders, fetchRegionHaulingSnapshotsOnly } from '../../utils/market.js';
import { fetchRegions, fetchStructures, fetchStationsNPC, fetchMarketTree, fetchRouteJumps, fetchDataLastCommitTime, fetchRouteSystems } from '../../utils/api.js';
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
    // Multi-select security allowlist (defaults to allow all)
    securityAllow: { high: true, low: true, nullsec: true },
    structureType: 'all',
    routePreference: 'safest',
    hideOutOfStock: false
};

export default function RegionHauling() {
    const [formData, setFormData] = useState(INITIAL_FORM);
    const [regionsData, setRegionsData] = useState(null);
    const [marketTree, setMarketTree] = useState(null);
    const [loading, setLoading] = useState(false);
    // Real progress percentage (0-100) tied to actual transformation work
    const [searchProgress, setSearchProgress] = useState(0);
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
    // Global scan mode flag to control progress behavior and expensive computations
    const globalScanActive = React.useRef(false);
    // Table container width to clamp total table width during resizing
    const tableContainerRef = React.useRef(null);
    const containerWidthRef = React.useRef(0);

    // Experimental: Search All Regions feature
    // Toggle this flag to show/hide the checkbox in UI (no env var required)
    const SHOW_SEARCH_ALL_REGIONS = true;
    const [searchAllRegions, setSearchAllRegions] = useState(false);

    // Timer state for "Time Since Last Update" based on GitHub data commits
    const [lastResultsAt, setLastResultsAt] = useState(null);
    const [nowTick, setNowTick] = useState(Date.now());
    // Track commit time at last successful search and whether newer data exists
    const [searchCommitAt, setSearchCommitAt] = useState(null);
    const [refreshAvailable, setRefreshAvailable] = useState(false);
    // Track unknown structure IDs encountered (for potential enrichment trigger)
    const unknownStructureIds = React.useRef(new Set());
    // Column widths for resizable headers (px)
    const [colWidths, setColWidths] = useState({
        'Item': 94,
        'From': 130,
        'Quantity': 110,
        'Buy Price': 130,
        'Total Buy Price': 140,
        'To': 130,
        'Sell Price': 140,
        'Net Profit': 140,
        'Jumps': 60,
        'Profit per Jump': 114,
        'Profit Per Item': 130,
        'ROI': 68,
        'Total Capacity (m³)': 120,
    });

    // Explicit header order so <colgroup> widths match headers exactly
    const HEADER_ORDER = [
        'Item',
        'From',
        'Quantity',
        'Buy Price',
        'Total Buy Price',
        'To',
        'Sell Price',
        'Net Profit',
        'Jumps',
        'Profit per Jump',
        'Profit Per Item',
        'ROI',
        'Total Capacity (m³)'
    ];

    // Compute total table width so resizing one column doesn't compress others
    const totalTableWidth = useMemo(() => {
        try {
            return HEADER_ORDER.reduce((sum, key) => sum + (Number(colWidths[key]) || 120), 0);
        } catch {
            return 1400; // fallback
        }
    }, [colWidths]);

    const startResize = (key, startX, startWidth) => {
        const onMove = (e) => {
            const dx = (e.clientX || 0) - startX;
            setColWidths(prev => {
                const minW = 60;
                const maxW = 800;
                const proposed = Math.round(startWidth + dx);
                // Compute current total and current width of this column
                const keys = Object.keys(prev);
                let total = 0;
                for (const k of keys) total += Number(prev[k]) || 0;
                const currentWidth = Number(prev[key]) || 0;
                // Available growth without exceeding container width
                const containerW = containerWidthRef.current || 0;
                const availableGrow = Math.max(0, containerW - total);
                // Cap growth so new total <= container width
                let capped = proposed;
                if (proposed > currentWidth) {
                    capped = Math.min(proposed, currentWidth + availableGrow);
                }
                const nextWidth = Math.max(minW, Math.min(maxW, capped));
                return { ...prev, [key]: nextWidth };
            });
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

    // Calculate jumps honoring routePreference (shortest vs safest/high-sec only)
    const jumpCache = React.useRef(new Map());
    const systemSecurityCache = React.useRef(new Map());
    const calculateJumps = async (fromSystemId, toSystemId) => {
        const key = `${fromSystemId}->${toSystemId}:${formData.routePreference}`;
        if (jumpCache.current.has(key)) return jumpCache.current.get(key);
        try {
            const flag = formData.routePreference === 'safest' ? 'secure' : 'shortest';
            const systems = await fetchRouteSystems(fromSystemId, toSystemId, flag);
            if (!systems) {
                jumpCache.current.set(key, null);
                return null;
            }
            if (flag === 'secure') {
                const anyLow = systems.some(sid => {
                    const sec = systemSecurityCache.current.get(sid);
                    return typeof sec === 'number' && sec < 0.5;
                });
                if (anyLow) {
                    jumpCache.current.set(key, null);
                    return null;
                }
            }
            const hops = Math.max(0, systems.length - 1);
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

    // Data transformation function to convert API/market data to display format
    const transformApiResponseToDisplayFormat = async (apiData, formData, onProgress) => {
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

        const total = apiData.length || 0;
        let indexCounter = 0;
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
            // Compute total capacity utilized (was Total Volume): quantity * item volume
            const totalCapacity = Math.floor((maxUnits || 0) * (itemDetails.volume || 0));

            // Use enhanced data directly from the API if available
            // If not, fall back to local lookup methods
            let originStationName, destinationStationName, originIsNPC, destinationIsNPC, jumps;
            // Ensure info objects are declared in outer scope for later use
            let originInfo = null, destInfo = null;
            const originId = trade.origin_id ?? trade.from_location ?? trade.source_station_id;
            const destId = trade.destination_id ?? trade.to_location ?? trade.destination_station_id;
            const normalizeIsNpc = (val, id) => {
                if (val === 1 || val === true) return true;
                if (val === 0 || val === false) return false;
                // Fallback by ID heuristic: Upwell structures have very large IDs (>= 1e12)
                if (Number.isFinite(Number(id))) return Number(id) < 1_000_000_000_000;
                return null;
            };
            const resolveIsNPCFromInfo = (info, id, isStationEntry) => {
                if (isStationEntry) return true; // stations.json => NPC
                if (info && typeof info === 'object') {
                    if (info.type === 'station') return true;
                    if (info.type === 'structure') return false;
                    if (info.isNPC === true || info.is_npc === 1 || info.is_npc === true) return true;
                    if (info.isNPC === false || info.is_npc === 0) return false;
                }
                // Fallback to ID heuristic when unknown
                const byId = normalizeIsNpc(undefined, id);
                return byId;
            };

            // Use the enhanced data from our API if available
            if (trade.origin_name && trade.destination_name) {
                originStationName = trade.origin_name;
                destinationStationName = trade.destination_name;
                // Use explicit location types if provided
                const oType = (trade.origin_location_type || trade.origin_type || '').toString().toLowerCase();
                const dType = (trade.destination_location_type || trade.destination_type || '').toString().toLowerCase();
                if (oType === 'station') originIsNPC = true; else if (oType === 'structure') originIsNPC = false;
                if (dType === 'station') destinationIsNPC = true; else if (dType === 'structure') destinationIsNPC = false;
                // Parse is_npc flags robustly
                const parseBoolish = (v) => {
                    if (v === true || v === false) return v;
                    if (v === 1 || v === 0) return Boolean(v);
                    if (typeof v === 'string') {
                        const s = v.trim().toLowerCase();
                        if (s === 'true' || s === '1') return true;
                        if (s === 'false' || s === '0') return false;
                    }
                    return null;
                };
                if (originIsNPC == null) originIsNPC = parseBoolish(trade.origin_is_npc);
                if (destinationIsNPC == null) destinationIsNPC = parseBoolish(trade.destination_is_npc);
                if (originIsNPC == null) originIsNPC = normalizeIsNpc(undefined, originId) ?? true;
                if (destinationIsNPC == null) destinationIsNPC = normalizeIsNpc(undefined, destId) ?? true;
                jumps = trade.jumps ?? 'N/A';
            } else {
                // Fall back to local lookup for older API responses
                originInfo = stationMap.get(originId) || structMap.get(originId) || null;
                destInfo = stationMap.get(destId) || structMap.get(destId) || null;

                // Log missing structure IDs for debugging
                if (!(originInfo && originInfo.name) && originId && originId > 1000000000000) {
                    console.warn(`Missing origin structure ID: ${originId}`);
                    unknownStructureIds.current.add(originId);
                }
                if (!(destInfo && destInfo.name) && destId && destId > 1000000000000) {
                    console.warn(`Missing destination structure ID: ${destId}`);
                    unknownStructureIds.current.add(destId);
                }

                const originLooksStructure = Number(originId) >= 1_000_000_000_000;
                const destLooksStructure = Number(destId) >= 1_000_000_000_000;
                originStationName = (originInfo && originInfo.name) || (originLooksStructure ? `Unknown Structure (ID: ${originId})` : `Unknown Station (ID: ${originId})`);
                destinationStationName = (destInfo && destInfo.name) || (destLooksStructure ? `Unknown Structure (ID: ${destId})` : `Unknown Station (ID: ${destId})`);

                // Determine NPC vs Player using info, station list membership, and fallback heuristic
                const originIsStationEntry = stationMap.has(originId);
                const destIsStationEntry = stationMap.has(destId);
                originIsNPC = resolveIsNPCFromInfo(originInfo, originId, originIsStationEntry);
                destinationIsNPC = resolveIsNPCFromInfo(destInfo, destId, destIsStationEntry);

                // Calculate jumps between systems (skip in global scan for speed)
                jumps = null;
                if (!globalScanActive.current) {
                    const fromSystemId = trade.origin_system_id || originInfo?.system_id || originInfo?.systemID || originInfo?.solarSystemID;
                    const toSystemId = trade.destination_system_id || destInfo?.system_id || destInfo?.systemID || destInfo?.solarSystemID;
                    if (fromSystemId && toSystemId) {
                        if (originInfo?.security_status != null) systemSecurityCache.current.set(fromSystemId, Number(originInfo.security_status));
                        if (destInfo?.security_status != null) systemSecurityCache.current.set(toSystemId, Number(destInfo.security_status));
                        jumps = await calculateJumps(fromSystemId, toSystemId);
                        // Fallback: try basic shortest route if safest failed
                        if (jumps == null && formData.routePreference === 'safest') {
                            jumpCache.current.delete(`${fromSystemId}->${toSystemId}:safest`);
                            const systems = await fetchRouteSystems(fromSystemId, toSystemId, 'shortest').catch(() => null);
                            if (systems) jumps = Math.max(0, systems.length - 1);
                        }
                    }
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
                'Total Capacity (m3)': totalCapacity,
                'Item Volume': trade.volume || itemDetails.volume,
                'Jumps': jumps,
                'Profit per Jump': profitPerJump,
                'Total Profit': trade.total_profit || ((trade.profit_per_unit || 0) * maxUnits),
                'ROI': trade.profit_margin,
                '_rawData': trade
            });

            indexCounter++;
            if (onProgress && total > 0) {
                // Trade processing weight handled externally; here we emit fractional completion of transform phase
                if (indexCounter === total || indexCounter % 5 === 0) {
                    onProgress(indexCounter / total);
                }
            }
        }

        // Apply post-transform filters
        let finalTrades = transformedTrades;

        // Drop rows that end up with zero quantity after budget/capacity limits
        finalTrades = finalTrades.filter(t => (Number(t['Quantity']) || 0) > 0);

        // Apply sales tax to profits (default 7.5% if not set)
        const salesTax = typeof formData.salesTax === 'number' ? formData.salesTax : 7.5;
        finalTrades = finalTrades.map(t => {
            // Sales tax is applied to the sell price (revenue), not buy price
            // Net profit after tax: profit - (salesTax% * sellPrice * quantity / 100)
            const qty = Number(t['Quantity']) || 0;
            const sellPrice = Number(t['Sell Price']) || 0;
            const grossProfit = Number(t['Total Profit']) || 0;
            const taxAmount = (salesTax / 100) * sellPrice * qty;
            const netProfit = grossProfit - taxAmount;
            return {
                ...t,
                'Total Profit': netProfit,
                'Net Profit': netProfit // for sorting
            };
        });

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

        // Security filter (multi-select). When all selected, skip filtering.
        if (formData.securityAllow) {
            const allow = formData.securityAllow;
            const allSelected = !!allow.high && !!allow.low && !!allow.nullsec;
            if (!allSelected) {
                const isHigh = s => typeof s === 'number' && s >= 0.5;
                const isLow = s => typeof s === 'number' && s > 0 && s < 0.5;
                const isNull = s => typeof s === 'number' && s <= 0;
                const inAllowed = (s) => (
                    (allow.high && isHigh(s)) || (allow.low && isLow(s)) || (allow.nullsec && isNull(s))
                );
                finalTrades = finalTrades.filter(t => {
                    const os = t.From?.security;
                    const ds = t.To?.security;
                    if (os == null || ds == null) return false;
                    return inAllowed(os) && inAllowed(ds);
                });
            }
        }

        // Structure type filter (NPC vs Player)
        if (formData.structureType && formData.structureType !== 'all') {
            finalTrades = finalTrades.filter(t => {
                const oNpc = t.From?.isNPC === true;
                const dNpc = t.To?.isNPC === true;
                if (formData.structureType === 'avoid-player') {
                    // Only NPC stations: both endpoints must be NPC
                    return oNpc && dNpc;
                }
                if (formData.structureType === 'avoid-npc') {
                    // Only player structures: both endpoints must be player
                    return !oNpc && !dNpc;
                }
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
    const fetchAndProcessMarketOrders = async (fromRegionId, toRegionId, formData, onPairProgress) => {
        try {
            // Use only GitHub snapshots: derive from region_orders (no region_hauling artifacts)
            const regionHaulingData = await fetchRegionHaulingSnapshotsOnly(fromRegionId, toRegionId);
            // Progress: snapshots fetched (~10%)
            if (typeof onPairProgress === 'function') {
                onPairProgress(0.1);
            } else if (!globalScanActive.current) {
                setSearchProgress(10);
            }

            // Pre-filter only by ROI and sign. Do NOT pre-filter by budget or min profit here,
            // because quantity can be reduced later (partial orders) to fit budget/capacity.
            const profitableTrades = regionHaulingData.filter(route => {
                const unitProfit = (route.profit_per_unit ?? (route.buy_price - route.sell_price) ?? 0);
                const roi = (route.profit_margin ?? (route.sell_price ? ((unitProfit / route.sell_price) * 100) : 0));
                // Keep only positive unit profit and ROI threshold; remaining checks happen post-quantity capping
                return unitProfit > 0 && (roi >= parseFloat(formData.minROI || 0));
            });

            // Transform data for display with progress updates (remaining 90%)
            const totalTransformWeight = 90; // percent
            const data = await transformApiResponseToDisplayFormat(profitableTrades, formData, (fraction) => {
                // fraction 0..1 of transform portion
                const pct = 10 + Math.min(1, Math.max(0, fraction)) * totalTransformWeight;
                if (typeof onPairProgress === 'function') {
                    const pairProgress = 0.1 + Math.min(1, Math.max(0, fraction)) * 0.9;
                    onPairProgress(pairProgress);
                } else if (!globalScanActive.current) {
                    setSearchProgress(prev => (pct > prev ? Math.round(pct) : prev));
                }
            });
            if (typeof onPairProgress === 'function') {
                onPairProgress(1);
            } else if (!globalScanActive.current) {
                setSearchProgress(100);
            }
            return data;
        } catch (error) {
            console.error('Error fetching or processing market orders:', error);
            throw new Error('Failed to fetch market orders.');
        }
    };

    // Helper: Scan all region pairs for best routes when no specific regions are selected
    // NOTE: This can be heavy. It is dev-only by default. Adjust MAX_PAIRS to cap workload.
    const fetchBestRoutesAcrossAllRegions = async (formData) => {
        if (!regions || regions.length === 0) throw new Error('Regions not loaded');

        // Build pairs list (from != to)
        const ids = regions.map(r => Number(r.regionID)).filter(n => Number.isFinite(n));
        const pairs = [];
        for (let i = 0; i < ids.length; i++) {
            for (let j = 0; j < ids.length; j++) {
                if (i === j) continue;
                pairs.push([ids[i], ids[j]]);
            }
        }

        // Safety cap to avoid overwhelming client/network; increase if needed in dev
        const MAX_PAIRS = null; // lower default for responsiveness (null=disabled ie: no limit)
        const work = pairs.slice(0, MAX_PAIRS);

        const allResults = [];
        const total = work.length;
        globalScanActive.current = true;
        for (let idx = 0; idx < work.length; idx++) {
            const [fromId, toId] = work[idx];
            try {
                // Reuse the same pipeline, reporting per-pair progress 0..1
                const data = await fetchAndProcessMarketOrders(fromId, toId, formData, (pairProgress) => {
                    const clamped = Math.max(0, Math.min(1, pairProgress || 0));
                    const overall = ((idx + clamped) / total) * 100;
                    const pct = Math.round(overall);
                    setSearchProgress(prev => (pct > prev ? pct : prev));
                });
                if (Array.isArray(data) && data.length > 0) allResults.push(...data);
            } catch {
                // continue on errors
            }
        }
        globalScanActive.current = false;
        setSearchProgress(100);
        return allResults;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setResults([]);
        setCurrentPage(1);
        setLoading(true);
        setSearchProgress(0);
        setError(null);
        setShowResults(false);


        // Experimental: Branch for global scan when both regions are unselected and toggle is on
        if (SHOW_SEARCH_ALL_REGIONS && searchAllRegions && !formData.fromRegion?.regionID && !formData.toRegion?.regionID) {
            try {
                const transformedData = await fetchBestRoutesAcrossAllRegions(formData);
                if (transformedData.length > 0) {
                    setResults(transformedData);
                    setUsingFallback(transformedData.some(r => r._rawData && r._rawData._fallback));
                    setShowResults(true);
                    if (lastResultsAt) setSearchCommitAt(lastResultsAt);
                } else {
                    setError('No profitable trades found across regions for the selected criteria.');
                }
            } catch (err) {
                setError(err.message || 'Failed to scan across regions.');
            } finally {
                setLoading(false);
            }
            return;
        }


        // Normal validation path
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
        setSearchProgress(0);
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
                    case 'Total Capacity (m³)': return item['Total Capacity (m3)'] || 0;
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

    // Reset progress to 0 when not loading and finished (optional: keep at 100 until next search)
    useEffect(() => {
        if (!loading && searchProgress === 100) {
            const t = setTimeout(() => setSearchProgress(0), 1500);
            return () => clearTimeout(t);
        }
    }, [loading, searchProgress]);

    // Measure and track table container width to constrain resizing within viewport
    useEffect(() => {
        const measure = () => {
            const el = tableContainerRef.current;
            if (el) {
                containerWidthRef.current = el.clientWidth;
            }
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [showResults]);

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
                    <p
                        className="disclaimer"
                        title={lastResultsAt ? new Date(lastResultsAt).toLocaleString() : ''}
                        style={{ marginTop: 6 }}
                    >
                        Last Data Update: {renderSinceLastUpdate()} ago
                    </p>
                </div>
            </div>

            <div className="scrollable-content">
                {/* Red area: Scrollable content */}
                <div className="hauling-form">
                    <form onSubmit={handleSubmit}>
                        <div className="form-container">
                            <div className="form-row top-row-fixed-6">
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
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="checkbox"
                                                checked={!!(formData.securityAllow?.high)}
                                                onChange={(e) => handleInputChange('securityAllow', { ...(formData.securityAllow || {}), high: e.target.checked })}
                                            />
                                            High-sec
                                        </label>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="checkbox"
                                                checked={!!(formData.securityAllow?.low)}
                                                onChange={(e) => handleInputChange('securityAllow', { ...(formData.securityAllow || {}), low: e.target.checked })}
                                            />
                                            Low-sec
                                        </label>
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="checkbox"
                                                checked={!!(formData.securityAllow?.nullsec)}
                                                onChange={(e) => handleInputChange('securityAllow', { ...(formData.securityAllow || {}), nullsec: e.target.checked })}
                                            />
                                            Null-sec
                                        </label>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Stations/Structures</label>
                                    <select
                                        value={formData.structureType}
                                        onChange={e => handleInputChange('structureType', e.target.value)}
                                        className="form-control"
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
                                    />
                                </div>
                            </div>
                            <div className="form-row second-row-fixed-5">
                                <div className="form-group">
                                    <label>Max Budget</label>
                                    <input type="number" value={formData.maxBudget ?? ''} onChange={e => handleInputChange('maxBudget', e.target.value)} placeholder="∞" className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Max Capacity (m³)</label>
                                    <input type="number" value={formData.maxWeight ?? ''} onChange={e => handleInputChange('maxWeight', e.target.value)} placeholder="∞" className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Sales Tax</label>
                                    <select value={formData.salesTax} onChange={e => handleInputChange('salesTax', Number(e.target.value))} className="form-control">
                                        {salesTaxOptions.map(o => (<option key={o.level} value={o.tax}>{o.label}</option>))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Min Profit</label>
                                    <input type="number" value={formData.minProfit ?? ''} onChange={e => handleInputChange('minProfit', e.target.value)} placeholder="0" className="form-control" />
                                </div>
                                <div className="form-group">
                                    <label>Min ROI %</label>
                                    <input type="number" value={formData.minROI ?? ''} onChange={e => handleInputChange('minROI', e.target.value)} placeholder="0" className="form-control" />
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
                                    {/* Experimental: Search All Regions toggle UI */}
                                    <button
                                        type="submit"
                                        disabled={
                                            loading || (
                                                !(SHOW_SEARCH_ALL_REGIONS && searchAllRegions) && (!formData.fromRegion || !formData.toRegion)
                                            )
                                        }
                                        className="eve-button primary-search-btn"
                                    >
                                        {loading ? `Searching...${searchProgress}%` : 'Find Trade Routes'}
                                    </button>
                                </div>
                                {SHOW_SEARCH_ALL_REGIONS && (
                                    <div style={{ marginTop: 10 }}>
                                        <label
                                            className="form-check"
                                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={searchAllRegions}
                                                onChange={(e) => setSearchAllRegions(e.target.checked)}
                                                title="Scan all regions for best routes when no regions are selected"
                                            />
                                            <span>
                                                Search All Regions (Longer)
                                                <span style={{ display: 'block', fontSize: '0.85em', color: '#666' }}>
                                                    Leave both regions unselected to scan all.
                                                </span>
                                            </span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        </div>
                    </form>
                </div>

                {showResults && sortedResults.length > 0 && (
                    <div className="results-container">
                        <div className="results-header">
                            <h2>Trade Route Results ({sortedResults.length} found)</h2>
                            {refreshAvailable && (
                                <button
                                    type="button"
                                    onClick={handleRefresh}
                                    disabled={loading}
                                    className="eve-button refresh-btn"
                                    title="New data is available. Click to refresh results."
                                >
                                    {loading ? `Refreshing…${searchProgress}%` : 'New Data Available – Refresh'}
                                </button>
                            )}
                        </div>
                        <div className="results-table-container" ref={tableContainerRef}>
                            <table className="results-table wide-table" style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%' }}>
                                {/* generate cols from colWidths so default widths apply */}
                                <colgroup>
                                    {HEADER_ORDER.map(key => (
                                        <col key={key} style={{ width: `${colWidths[key]}px`, minWidth: `${colWidths[key]}px` }} />
                                    ))}
                                </colgroup>
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
                                        <HeaderCell label="Total Capacity (m³)" />
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
                                            const quantity = result['Quantity'] || 0;
                                            const totalBuyPrice = buyPrice * quantity;
                                            const sellPrice = result['Sell Price'] || 0;
                                            const totalProfit = result['Total Profit'] || 0;
                                            const jumps = (typeof result['Jumps'] === 'number') ? result['Jumps'] : '—';
                                            const profitPerJump = result['Profit per Jump'];
                                            const profitPerItem = result['Profit Per Unit'] || 0;
                                            const roi = result['Profit Percentage'] || 0;
                                            const totalCapacity = result['Total Capacity (m3)'] || 0;

                                            const originSecurity = fromStation.security;
                                            const destinationSecurity = toStation.security;

                                            const formatNum = (v, d = 2) => utils.formatNumber(v, d);

                                            return (
                                                <tr key={startIndex + index}>
                                                    <td
                                                        style={{ ...cellStyle('Item'), whiteSpace: 'normal', overflow: 'visible' }}
                                                        className="clickable-location wrap-cell"
                                                        title={`Copy: ${item}`}
                                                        onClick={() => copyToClipboard(item)}
                                                    >{item}</td>
                                                    <td
                                                        style={{ ...cellStyle('From'), whiteSpace: 'normal', overflow: 'visible' }}
                                                        className="clickable-location wrap-cell"
                                                        onClick={() => copyToClipboard(fromStation.name)}
                                                        title={`Copy: ${fromStation.name}`}
                                                    >
                                                        <span style={{ color: getSecurityColor(originSecurity) }}>
                                                            {fromStation.name}
                                                        </span>
                                                    </td>
                                                    <td style={{ ...cellStyle('Quantity') }}>{formatNum(quantity, 0)}</td>
                                                    <td style={cellStyle('Buy Price')}>{formatNum(buyPrice, 2)}</td>
                                                    <td style={cellStyle('Total Buy Price')}>{formatNum(totalBuyPrice, 2)}</td>
                                                    <td
                                                        style={{ ...cellStyle('To'), whiteSpace: 'normal', overflow: 'visible' }}
                                                        className="clickable-location wrap-cell"
                                                        onClick={() => copyToClipboard(toStation.name)}
                                                        title={`Copy: ${toStation.name}`}
                                                    >
                                                        <span style={{ color: getSecurityColor(destinationSecurity) }}>
                                                            {toStation.name}
                                                        </span>
                                                    </td>
                                                    <td style={cellStyle('Sell Price')}>{formatNum(sellPrice, 2)}</td>
                                                    <td style={cellStyle('Net Profit')}>{formatNum(totalProfit, 2)}</td>
                                                    <td style={{ ...cellStyle('Jumps') }}>{jumps}</td>
                                                    <td style={cellStyle('Profit per Jump')}>
                                                        {profitPerJump != null ? formatNum(profitPerJump, 2) : '—'}
                                                    </td>
                                                    <td style={cellStyle('Profit Per Item')}>{formatNum(profitPerItem, 2)}</td>
                                                    <td style={cellStyle('ROI')}>{formatNum(roi, 2)}%</td>
                                                    <td style={cellStyle('Total Capacity (m³)')}>{formatNum(totalCapacity, 0)}</td>
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
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        type="button"
                                    >
                                        Previous
                                    </button>
                                    <div className="pagination-info">
                                        Page {currentPage} of {Math.ceil(sortedResults.length / itemsPerPage)}
                                    </div>
                                    <button
                                        className="pagination-btn"
                                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(sortedResults.length / itemsPerPage), p + 1))}
                                        disabled={currentPage === Math.ceil(sortedResults.length / itemsPerPage)}
                                        type="button"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Return to Top */}
                <button
                    type="button"
                    className="eve-button return-to-top-btn no-notch"
                    onClick={() => {
                        const container = document.querySelector('.region-hauling');
                        if (container) {
                            container.scrollTo({ top: 0, behavior: 'smooth' });
                        } else {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                    }}
                    aria-label="Return to top"
                >
                    ^
                </button>
            </div>
        </div>
    );
}
