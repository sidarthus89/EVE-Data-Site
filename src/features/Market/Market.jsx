// src/features/Market/Market.jsx

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import MarketSidebar from './MarketSidebar';
import ItemViewer from './ItemViewer';
import MarketTables from './MarketTables';
import MarketDistribution from './MarketDistribution.jsx';
import MarketHistory from './MarketHistory.jsx';
import PLEXMarketTicker from './PLEXMarketTicker.jsx';
import './Market.css';
import { fetchMarketOrders } from '../../utils/market.js';
import { applyOutlierFilter, flattenMarketTree } from '../../utils/common.js';
import { fetchStructures, fetchRegions, fetchStationsNPC } from '../../utils/api.js';

// If your regions.json is a raw array, this loader handles both raw and wrapped formats
async function loadRegionsFile() {
    const url = `${import.meta.env.BASE_URL}data/regions.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load regions.json');
    const data = await res.json();
    return Array.isArray(data) ? data : data.regions || [];
}

export default function Market() {
    // Core UI state
    const [marketTree, setMarketTree] = useState(null);
    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedRegion, setSelectedRegion] = useState({ regionID: 'all', regionName: 'All Regions' });
    const [activeTab, setActiveTab] = useState('orders');
    const [breadcrumbPath, setBreadcrumbPath] = useState(null);

    // Market data state
    const [sellers, setSellers] = useState([]);
    const [buyers, setBuyers] = useState([]);
    const [filterOutliers, setFilterOutliers] = useState('none');

    // Dynamic data sources
    const [regions, setRegions] = useState([]);         // loaded from /data/regions.json
    const [structures, setStructures] = useState([]);   // loaded from /data/structures.json
    const [stations, setStations] = useState([]);       // loaded from /data/stations*.json

    // Location metadata map (stations + structures)
    const [locationInfoMap, setLocationInfoMap] = useState({});

    // Derived search params
    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const selectedItemID = parseInt(queryParams.get('item') || '0', 10);

    // Error state
    const [marketTreeError, setMarketTreeError] = useState(null);

    // Load the static market tree locally (baked into src/data)
    useEffect(() => {
        // Load market tree at runtime from /data to avoid bundling large JSON
        const url = `${import.meta.env.BASE_URL}data/market.json`;
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error('Failed to load market.json');
                return res.json();
            })
            .then(json => {
                let treeArray = json;
                if (treeArray && !Array.isArray(treeArray) && typeof treeArray === 'object') {
                    treeArray = Object.entries(treeArray).map(([name, node]) => ({ ...node, name }));
                }
                if (!Array.isArray(treeArray) || treeArray.length === 0) {
                    setMarketTreeError('Market tree data is empty or invalid.');
                    setMarketTree(null);
                } else {
                    setMarketTreeError(null);
                    setMarketTree(treeArray);
                }
            })
            .catch(() => {
                setMarketTreeError('Failed to load market tree.');
                setMarketTree(null);
            });
    }, []);

    // Flatten the tree for quick lookup and breadcrumbs
    const flattenedMarketTree = useMemo(() => {
        if (!marketTree) return { items: [], pathMap: {} };
        return flattenMarketTree(marketTree);
    }, [marketTree]);

    // Load dynamic regions and structures
    useEffect(() => {
        fetchRegions()
            .then(setRegions)
            .catch(err => console.error('❌ Failed to load regions:', err));
    }, []);

    useEffect(() => {
        if (!regions.length) return; // Wait for region metadata

        const buildMap = async () => {
            const regionMap = new Map();
            regions.forEach(r => regionMap.set(Number(r.regionID), r.regionName));

            const mergedMap = {};

            try {
                const stationsRaw = await fetchStationsNPC();
                // Normalize stations: support array of objects or object map keyed by id
                let stationsArr = [];
                if (Array.isArray(stationsRaw)) {
                    stationsArr = stationsRaw;
                } else if (stationsRaw && typeof stationsRaw === 'object') {
                    stationsArr = Object.entries(stationsRaw).map(([id, s]) => ({
                        station_id: Number(id),
                        ...s
                    }));
                }
                setStations(stationsArr);
                stationsArr.forEach(station => {
                    const stationId = Number(station.station_id ?? station.stationID);
                    if (!Number.isFinite(stationId)) return;
                    const name = station.name || station.stationName || station.locationName || 'Unknown';
                    const regionName = station.region_name || station.regionName || regionMap.get(Number(station.region_id ?? station.regionID)) || 'Unknown';
                    const security = (typeof station.security_status === 'number') ? station.security_status
                        : (typeof station.security === 'number') ? station.security
                            : (typeof station.securityStatus === 'number') ? station.securityStatus
                                : null;
                    mergedMap[stationId] = {
                        name,
                        security,
                        regionName,
                        type: 'station',
                        isNPC: true
                    };
                });
            } catch (e) {
                console.error('❌ Failed to load NPC stations:', e);
            }

            // Player-owned structures from structures.json
            structures.forEach(structure => {
                // structures.json uses structureID (not stationID)
                const structureId = Number(structure.structureID ?? structure.stationID);
                if (!Number.isFinite(structureId)) return;
                mergedMap[structureId] = {
                    name: structure.locationName || structure.name || 'Unknown',
                    security: typeof structure.security === 'number' ? structure.security : null,
                    regionName: structure.regionName || regionMap.get(Number(structure.regionID)) || 'Unknown',
                    type: 'structure',
                    isNPC: false // structures are player-owned by default
                };
            });

            console.log(`📍 Total locations (NPC + Structures): ${Object.keys(mergedMap).length}`);
            setLocationInfoMap(mergedMap);
        };

        buildMap();
    }, [regions, structures]);

    useEffect(() => {
        fetchStructures()
            .then(setStructures)
            .catch(err => console.error('❌ Failed to load structures:', err));
    }, []);

    // Handle ?item= selection in URL
    // On first load, if ?item= is present, select it but keep the query so share links still work on refresh.
    // After the user manually selects another item, we can clear the query.
    const [initialQueryHandled, setInitialQueryHandled] = useState(false);
    useEffect(() => {
        if (!flattenedMarketTree?.items?.length || initialQueryHandled) return;
        if (selectedItemID) {
            const item = flattenedMarketTree.items.find(entry => entry.typeID === selectedItemID);
            if (item) {
                setSelectedItem(item);
                setBreadcrumbPath(flattenedMarketTree.pathMap[selectedItemID]);
                setActiveTab('orders');
                setInitialQueryHandled(true);
            }
        } else {
            setInitialQueryHandled(true);
        }
    }, [flattenedMarketTree, selectedItemID, initialQueryHandled]);

    // Clear the query param when user selects a different item (not the initial deep-link one)
    useEffect(() => {
        if (!initialQueryHandled) return;
        const params = new URLSearchParams(window.location.search);
        if (params.has('item')) {
            // Remove only after initial handling is done and selection changed
            params.delete('item');
            const url = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
            window.history.replaceState({}, '', url);
        }
    }, [selectedItem, initialQueryHandled]);

    // Helper: find item by id in raw or normalized tree
    const findItemById = (typeID, tree) => {
        const target = Number(typeID);
        const searchInNode = (node) => {
            if (!node || typeof node !== 'object') return null;
            if (Array.isArray(node.items)) {
                const found = node.items.find(item => Number(item.typeID) === target);
                if (found) return found;
            }
            for (const [key, value] of Object.entries(node)) {
                if (key === '_info' || key === 'items') continue;
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const found = searchInNode(value);
                    if (found) return found;
                }
            }
            return null;
        };
        if (Array.isArray(tree)) {
            for (const topNode of tree) {
                const found = searchInNode(topNode);
                if (found) return found;
            }
        } else {
            for (const [, topValue] of Object.entries(tree)) {
                if (topValue && typeof topValue === 'object') {
                    const found = searchInNode(topValue);
                    if (found) return found;
                }
            }
        }
        return null;
    };

    // Breadcrumb helper for ItemViewer
    function findItemBreadcrumb(typeID, tree) {
        const target = Number(typeID);
        let result = [];

        function containsTypeId(arr) {
            return Array.isArray(arr) && arr.some(x => x && typeof x === 'object' && Number(x.typeID) === target);
        }

        function getCategoryDisplayName(fallbackKey) {
            return fallbackKey;
        }

        function walk(node, trail = [], parentKey) {
            if (!node || typeof node !== 'object') return false;

            if (trail.length === 0 && parentKey) {
                const displayName = getCategoryDisplayName(parentKey);
                trail = [{ key: parentKey, name: displayName }];
            }

            if (containsTypeId(node.items)) {
                result = trail.map(t => t.name);
                return true;
            }

            for (const [k, v] of Object.entries(node)) {
                if (k === '_info' || k === 'items') continue;
                if (Array.isArray(v) && containsTypeId(v)) {
                    result = trail.map(t => t.name);
                    return true;
                }
            }

            for (const [key, value] of Object.entries(node)) {
                if (key === '_info' || key === 'items') continue;
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const displayName = getCategoryDisplayName(key);
                    if (walk(value, [...trail, { key, name: displayName }], key)) return true;
                }
            }
            return false;
        }

        if (Array.isArray(tree)) {
            for (const topNode of tree) {
                if (topNode && typeof topNode === 'object') {
                    const topKey = topNode.name || 'Unknown';
                    if (walk(topNode, [], topKey)) return result;
                }
            }
        } else {
            for (const [topKey, topValue] of Object.entries(tree)) {
                if (topValue && typeof topValue === 'object' && !Array.isArray(topValue)) {
                    if (walk(topValue, [], topKey)) return result;
                }
            }
        }
        return ['Unknown Category'];
    }

    // Fetch orders for selected item and region scope
    const fetchOrders = useCallback(async () => {
        if (!selectedItem || !regions.length) return;

        try {
            let allOrders = [];
            const regionID = selectedRegion?.regionID;

            // PLEX special handling: region 19000001
            const PLEX_TYPE_ID = 44992;
            const PLEX_REGION_ID = 19000001;
            const isPLEX = selectedItem.typeID === PLEX_TYPE_ID;

            if (isPLEX) {
                const result = await fetchMarketOrders(selectedItem.typeID, PLEX_REGION_ID);
                const orders = [...(result.sellOrders || []), ...(result.buyOrders || [])];
                allOrders = orders.map(order => ({ ...order, region_id: PLEX_REGION_ID }));
            } else if (!regionID || regionID === 'all') {
                // Query ALL regions concurrently
                const orderPromises = regions.map(async (region) => {
                    try {
                        const result = await fetchMarketOrders(selectedItem.typeID, region.regionID);
                        const orders = [...(result.sellOrders || []), ...(result.buyOrders || [])];
                        return orders.map(order => ({ ...order, region_id: region.regionID }));
                    } catch {
                        return [];
                    }
                });
                const orderResults = await Promise.all(orderPromises);
                allOrders = orderResults.flat();
            } else {
                const result = await fetchMarketOrders(selectedItem.typeID, regionID);
                const orders = [...(result.sellOrders || []), ...(result.buyOrders || [])];
                allOrders = orders.map(order => ({ ...order, region_id: order.region_id || regionID }));
            }

            // Apply outlier filters and split buyers/sellers
            const sellersList = applyOutlierFilter(allOrders.filter(o => !o.is_buy_order), filterOutliers);
            const buyersList = applyOutlierFilter(allOrders.filter(o => o.is_buy_order), filterOutliers);

            setSellers(sellersList);
            setBuyers(buyersList);
        } catch (err) {
            console.error('Failed to fetch market orders:', err);
        }
    }, [selectedItem, selectedRegion, regions, filterOutliers]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    useEffect(() => {
        const allOrders = [...sellers, ...buyers];
        if (allOrders.length === 0) return;

        const updatedMap = { ...locationInfoMap };
        const regionIdToName = new Map(regions.map(r => [Number(r.regionID), r.regionName]));
        let newLocationsAdded = 0;

        allOrders.forEach(order => {
            const id = Number(order.location_id);
            if (!Number.isFinite(id) || id <= 0) return;
            if (!updatedMap[id]) {
                // Try resolve from known stations/structures first
                const station = stations.find(s => Number(s.station_id ?? s.stationID) === id);
                if (station) {
                    const name = station.name || station.stationName || station.locationName || 'Unknown';
                    const regionName = station.region_name || station.regionName || regionIdToName.get(Number(station.region_id ?? station.regionID)) || 'Unknown';
                    const security = (typeof station.security_status === 'number') ? station.security_status
                        : (typeof station.security === 'number') ? station.security
                            : (typeof station.securityStatus === 'number') ? station.securityStatus
                                : null;
                    updatedMap[id] = { name, regionName, security, type: 'station', isNPC: true };
                    newLocationsAdded++;
                    return;
                }
                const structure = structures.find(s => Number(s.structureID ?? s.stationID) === id);
                if (structure) {
                    const name = structure.locationName || structure.name || 'Unknown';
                    const regionName = structure.regionName || regionIdToName.get(Number(structure.regionID)) || 'Unknown';
                    const security = (typeof structure.security === 'number') ? structure.security : null;
                    updatedMap[id] = { name, regionName, security, type: 'structure', isNPC: false };
                    newLocationsAdded++;
                    return;
                }
                const name = order.name || order.location_name;
                const regionName = order.region_name || order.regionName || regionIdToName.get(Number(order.region_id)) || 'Unknown Region';
                updatedMap[id] = {
                    name: name || 'Unknown Location',
                    regionName: regionName || 'Unknown Region',
                    security: typeof order.security === 'number' ? order.security :
                        (typeof order.security_status === 'number' ? order.security_status : null),
                    type: order.location_type || order.type || 'unknown',
                    isNPC: (order.is_npc === 1 || order.isNPC === true) ?? (id < 1000000000000)
                };
                newLocationsAdded++;
            }
        });

        if (newLocationsAdded > 0) {
            console.log(`📍 Added ${newLocationsAdded} new locations from market orders`);
            console.log('📍 Updated locationInfoMap size:', Object.keys(updatedMap).length);
            setLocationInfoMap(updatedMap);
        }
    }, [sellers, buyers]);

    // Distribution view orders annotated with region names
    const allOrdersWithRegion = useMemo(() => {
        const allOrders = [...sellers, ...buyers];
        const regionNameMap = new Map(regions.map(r => [Number(r.regionID), r.regionName]));
        return allOrders.map(order => ({
            ...order,
            regionName: regionNameMap.get(Number(order.region_id)) || `Region ${order.region_id || 'Unknown'}`
        }));
    }, [sellers, buyers, regions]);

    const handleRegionFromDistribution = (regionName) => {
        const region = regions?.find(r => r.regionName === regionName);
        if (region) {
            setSelectedRegion({ regionID: region.regionID, regionName: region.regionName });
            setActiveTab('orders');
        }
    };

    const handleItemSelect = (item) => {
        setSelectedItem(item);
        if (window.location.search) {
            const currentUrl = new URL(window.location.href);
            currentUrl.search = '';
            window.history.replaceState({}, '', currentUrl.toString());
        }
        setActiveTab('orders');
    };

    // Back/forward handling for ?item=
    useEffect(() => {
        const handlePopState = () => {
            const urlParams = new URLSearchParams(window.location.search);
            const itemId = urlParams.get('item');
            if (itemId && marketTree) {
                const item = findItemById(itemId, marketTree);
                if (item) setSelectedItem(item);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [marketTree]);

    const handleBreadcrumbClick = (breadcrumbSegments) => {
        setBreadcrumbPath(breadcrumbSegments);
        setTimeout(() => {
            const targetPath = breadcrumbSegments.join('/');
            const element = document.querySelector(`[data-path="${targetPath}"]`);
            if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    };

    return (
        <div className="market">
            {marketTreeError && (
                <div style={{ color: 'red', padding: '1rem' }}>{marketTreeError}</div>
            )}

            <div className="market-body">
                <div className="left-panel">
                    <MarketSidebar
                        selectedRegion={selectedRegion}
                        onRegionChange={setSelectedRegion}
                        regions={regions}
                        onItemSelect={handleItemSelect}
                        marketTree={marketTree}
                        breadcrumbPath={breadcrumbPath}
                    />
                </div>

                <div className="right-panel">
                    {selectedItem && !marketTreeError && (
                        <>
                            <ItemViewer
                                selectedItem={selectedItem}
                                marketTree={marketTree}
                                onBreadcrumbClick={handleBreadcrumbClick}
                            />

                            <div className="market-tabs-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="market-tabs">
                                    <button className={activeTab === 'orders' ? 'active' : ''} onClick={() => setActiveTab('orders')}>Market Orders</button>
                                    <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>Market History</button>
                                    <button className={activeTab === 'distribution' ? 'active' : ''} onClick={() => setActiveTab('distribution')}>Market Distribution</button>

                                    <div style={{ marginLeft: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span>Outlier Filter: </span>
                                        <select
                                            value={filterOutliers}
                                            onChange={(e) => setFilterOutliers(e.target.value)}
                                            style={{
                                                padding: '2px 4px',
                                                background: '#2a2a2a',
                                                color: '#eee',
                                                border: '1px solid #444',
                                                borderRadius: '4px'
                                            }}
                                        >
                                            <option value="none">No outlier prices filtered out</option>
                                            <option value="mild">5th to 95th percentile (1.5 IQR)</option>
                                            <option value="moderate">10th to 90th percentile (1.0 IQR)</option>
                                            <option value="strict">25th to 75th percentile (0.5 IQR)</option>
                                            <option value="ultra">37.5th to 62.5th percentile (0.25 IQR)</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="market-tabs-right" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }} />
                            </div>

                            {activeTab === 'orders' && Object.keys(locationInfoMap).length > 0 && (
                                <MarketTables
                                    sellers={sellers}
                                    buyers={buyers}
                                    selectedRegion={selectedRegion}
                                    locationInfoMap={locationInfoMap}
                                    activeTab={activeTab}
                                    setActiveTab={setActiveTab}
                                    itemName={selectedItem?.typeName}
                                />
                            )}

                            {activeTab === 'history' && (
                                <MarketHistory
                                    selectedItem={selectedItem}
                                    selectedRegion={selectedRegion}
                                />
                            )}

                            {activeTab === 'distribution' && (
                                <MarketDistribution
                                    orders={allOrdersWithRegion}
                                    regions={regions}
                                    selectedRegion={selectedRegion}
                                    onRegionClick={handleRegionFromDistribution}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

            <PLEXMarketTicker
                regionsData={regions}
                filterOutliers={filterOutliers}
            />
        </div>
    );
}