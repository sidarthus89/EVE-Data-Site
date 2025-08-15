import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import MarketSidebar from './MarketSidebar';
import ItemViewer from './ItemViewer';
import MarketTables from './MarketTables';
import MarketDistribution from './MarketDistribution.jsx';
import MarketHistory from './MarketHistory.jsx';
import PLEXMarketTicker from './PLEXMarketTicker.jsx';
import './Market.css';
import {
    fetchOrdersForAllRegions,
    fetchMarketOrders,
    getRegionID,
    fetchJSON
} from '../../api/esiAPI.js';
import { buildStationRegionMap, flattenMarketTree } from '../../api/dataTransforms.js';


function applyOutlierFilter(orders, filterEnabled) {
    if (!filterEnabled || orders.length <= 10) return orders;
    const sorted = [...orders].sort((a, b) => a.price - b.price);
    const lower = Math.floor(sorted.length * 0.01);
    const upper = Math.ceil(sorted.length * 0.99);
    return sorted.slice(lower, upper);
}

export default function Market() {
    const [marketTree, setMarketTree] = useState(null);
    const [locationsData, setLocationsData] = useState(null);
    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedRegion, setSelectedRegion] = useState({ regionID: 'all', regionName: 'All Regions' });
    const [activeTab, setActiveTab] = useState('orders');
    const [breadcrumbPath, setBreadcrumbPath] = useState(null);
    const [sellers, setSellers] = useState([]);
    const [buyers, setBuyers] = useState([]);
    const [filterOutliers, setFilterOutliers] = useState(true);
    const [averagePrice, setAveragePrice] = useState(null);

    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const selectedItemID = parseInt(queryParams.get('item') || '0', 10);

    // Regions list
    const regions = useMemo(() => {
        if (!locationsData?.regionLookup) return [];
        return Object.entries(locationsData.regionLookup)
            .map(([regionID, name]) => ({ regionID, regionName: name }))
            .sort((a, b) => a.regionName.localeCompare(b.regionName));
    }, [locationsData]);

    // Load market tree
    useEffect(() => {
        fetchMarketTree()
            .then(setMarketTree)
            .catch(err => console.error('❌ Failed to load market-tree', err));
    }, []);

    useEffect(() => {
        fetchLocations()
            .then(setLocationsData)
            .catch(err => console.error('❌ Failed to load locations', err));
    }, []);

    // Select item from URL param (optional)
    useEffect(() => {
        const { items, pathMap } = flattenedMarketTree;
        if (!items.length || !selectedItemID) return;

        const item = items.find(entry => entry.typeID === selectedItemID);
        if (item) {
            setSelectedItem(item);
            setBreadcrumbPath(pathMap[selectedItemID]);
        }
    }, [flattenedMarketTree, selectedItemID]);


    // Build NPC station ID set
    const npcStationIDs = useMemo(() => {
        if (!locationsData) return new Set();
        const ids = new Set();
        Object.values(locationsData).forEach(region => {
            Object.values(region).forEach(constellation => {
                Object.values(constellation).forEach(system => {
                    if (system.stations) {
                        Object.keys(system.stations).forEach(id => ids.add(parseInt(id)));
                    }
                });
            });
        });
        return ids;
    }, [locationsData]);

    const locationIDToRegion = useMemo(() => {
        return locationsData ? buildStationRegionMap(locationsData) : {};
    }, [locationsData]);

    // Compute average sell price
    const averagePriceCache = useMemo(() => new Map(), []);
    const computeAveragePrice = useCallback(async () => {
        if (!selectedItem || !locationsData) return;
        const cacheKey = `${selectedItem.typeID}-${filterOutliers ? 'filtered' : 'raw'}`;
        if (averagePriceCache.has(cacheKey)) {
            setAveragePrice(averagePriceCache.get(cacheKey));
            return;
        }

        try {
            const allOrders = await fetchOrdersForAllRegions(selectedItem.typeID, locationsData);
            const sellOrders = allOrders.filter(o => !o.is_buy_order && o.volume_remain > 0);
            if (sellOrders.length === 0) {
                setAveragePrice(null);
                return;
            }
            const filtered = applyOutlierFilter(sellOrders, filterOutliers);
            const totalVolume = filtered.reduce((sum, o) => sum + o.volume_remain, 0);
            const weightedSum = filtered.reduce((sum, o) => sum + o.price * o.volume_remain, 0);
            const avg = totalVolume > 0 ? weightedSum / totalVolume : null;
            averagePriceCache.set(cacheKey, avg);
            setAveragePrice(avg);
        } catch (err) {
            console.error('❌ Failed to compute average price:', err);
        }
    }, [selectedItem, locationsData, filterOutliers, averagePriceCache]);

    useEffect(() => { computeAveragePrice(); }, [selectedItem?.typeID, filterOutliers, computeAveragePrice]);

    // Fetch orders
    const fetchOrders = useCallback(async () => {
        if (!selectedItem || !locationsData) return;
        try {
            let allOrders = [];
            const regionID = getRegionID(selectedRegion, locationsData);
            if (!regionID || regionID === 'all') {
                allOrders = await fetchOrdersForAllRegions(selectedItem.typeID, locationsData);
            } else {
                const result = await fetchMarketOrders(selectedItem.typeID, regionID);
                allOrders = [...result.sellOrders, ...result.buyOrders];
            }

            const sellersList = applyOutlierFilter(allOrders.filter(o => !o.is_buy_order && npcStationIDs.has(o.location_id)), filterOutliers);
            const buyersList = applyOutlierFilter(allOrders.filter(o => o.is_buy_order && npcStationIDs.has(o.location_id)), filterOutliers);

            setSellers(sellersList);
            setBuyers(buyersList);
        } catch (err) {
            console.error('❌ Failed to fetch market orders:', err);
        }
    }, [selectedItem, selectedRegion, locationsData, filterOutliers, npcStationIDs]);

    useEffect(() => { fetchOrders(); }, [fetchOrders]);

    const allOrdersWithRegion = useMemo(() => {
        const allOrders = [...sellers, ...buyers];
        return allOrders.map(order => ({
            ...order,
            regionName: locationIDToRegion[order.location_id] || 'Unknown',
        }));
    }, [sellers, buyers, locationIDToRegion]);

    const marketHistoryRegions = useMemo(() => {
        if (!locationsData) return [];
        if (selectedRegion.regionID === 'all') {
            return Object.entries(locationsData).map(([regionName, region]) => ({
                regionID: region.regionID,
                name: regionName,
            }));
        }
        const regionBlock = locationsData?.[selectedRegion.regionName];
        if (regionBlock?.regionID) return [{ regionID: regionBlock.regionID, name: selectedRegion.regionName }];
        return [];
    }, [locationsData, selectedRegion]);

    const handleRegionFromDistribution = (regionName) => {
        const regionBlock = locationsData?.[regionName];
        if (regionBlock?.regionID) {
            setSelectedRegion({ regionID: regionBlock.regionID, regionName });
            setActiveTab('orders');
        }
    };

    const handleItemSelect = (item) => setSelectedItem(item);

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
                    {selectedItem && (
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
                                </div>
                                <div className="market-tabs-right" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    {averagePrice !== null && (
                                        <div className="average-price-display" style={{ whiteSpace: 'nowrap' }}>
                                            Avg Sell Price: {averagePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK
                                        </div>
                                    )}
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input type="checkbox" checked={filterOutliers} onChange={() => setFilterOutliers(prev => !prev)} />
                                        Filter Avg Outliers
                                    </label>
                                </div>
                            </div>

                            {activeTab === 'orders' && (
                                <MarketTables
                                    sellers={sellers}
                                    buyers={buyers}
                                    locationsData={locationsData}
                                    selectedRegion={selectedRegion}
                                    filterOutliers={filterOutliers}
                                    setFilterOutliers={setFilterOutliers}
                                />
                            )}

                            {activeTab === 'history' && (
                                <MarketHistory
                                    selectedItem={selectedItem}
                                    regions={marketHistoryRegions}
                                />
                            )}

                            {activeTab === 'distribution' && (
                                <MarketDistribution
                                    selectedItem={selectedItem}
                                    orders={allOrdersWithRegion}
                                    onRegionSelect={handleRegionFromDistribution}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>
            <PLEXMarketTicker />
        </div>
    );
}
