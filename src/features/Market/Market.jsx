// src/features/Market/Market.jsx
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import MarketSidebar from './MarketSidebar';
import ItemViewer from './ItemViewer';
import MarketTables from './MarketTables';
//import MarketDistribution from './MarketDistribution.jsx';
//import MarketHistory from './MarketHistory.jsx';
import './Market.css';
import PLEXMarketTicker from './PLEXMarketTicker.jsx';
import { fetchOrdersForAllRegions, fetchMarketOrders, getRegionID, fetchJSON } from '../../api/esiAPI.js';
import { buildStationRegionMap } from '../../api/dataTransforms.js';

export default function Market() {
    const [marketTree, setMarketTree] = useState(null);
    const [locationsData, setLocationsData] = useState(null);

    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedRegion, setSelectedRegion] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('orders');
    const [breadcrumbPath, setBreadcrumbPath] = useState(null);

    const [sellers, setSellers] = useState([]);
    const [buyers, setBuyers] = useState([]);

    const location = useLocation();
    const queryParams = new URLSearchParams(location.search);
    const selectedItemID = parseInt(queryParams.get("item") || "0", 10);

    useEffect(() => {
        fetchJSON('market-tree')
            .then(setMarketTree)
            .catch(err => console.error('❌ Failed to load market-tree from Worker', err));
    }, []);

    useEffect(() => {
        fetchJSON('locations')
            .then(setLocationsData)
            .catch(err => console.error('❌ Failed to load locations from Worker', err));
    }, []);

    useEffect(() => {
        if (marketTree && selectedItemID) {
            const { items, pathMap } = flattenMarketTree(marketTree);
            const item = items.find(entry => entry.typeID === selectedItemID);
            if (item) {
                setSelectedItem(item);
                setBreadcrumbPath(pathMap[selectedItemID]);
            } else {
                console.warn(`Item ${selectedItemID} not found in marketTree`);
            }
        }
    }, [marketTree, selectedItemID]);

    const locationIDToRegion = useMemo(() => {
        return locationsData ? buildStationRegionMap(locationsData) : {};
    }, [locationsData]);

    const fetchOrders = useCallback(async () => {
        if (!selectedItem || !locationsData) return;

        try {
            let allOrders = [];
            if (selectedRegion === 'all') {
                allOrders = await fetchOrdersForAllRegions(selectedItem.typeID, locationsData);
            } else {
                const regionID = getRegionID(selectedRegion, locationsData);
                if (!regionID) return;
                const result = await fetchMarketOrders(selectedItem.typeID, regionID);
                allOrders = [...result.sellOrders, ...result.buyOrders];
            }

            const npcStationIDs = new Set();
            Object.values(locationsData).forEach(region => {
                Object.values(region).forEach(constellation => {
                    Object.values(constellation).forEach(system => {
                        if (system.stations) {
                            Object.keys(system.stations).forEach(id => npcStationIDs.add(parseInt(id)));
                        }
                    });
                });
            });

            const sellersList = allOrders.filter(o => !o.is_buy_order && npcStationIDs.has(o.location_id));
            const buyersList = allOrders.filter(o => o.is_buy_order && npcStationIDs.has(o.location_id));

            setSellers(sellersList);
            setBuyers(buyersList);
        } catch (err) {
            console.error('❌ Failed to fetch market orders:', err);
        }
    }, [selectedItem, selectedRegion, locationsData]);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const allOrdersWithRegion = useMemo(() => {
        const allOrders = [...sellers, ...buyers];
        return allOrders.map(order => ({
            ...order,
            regionName: locationIDToRegion[order.location_id] || 'Unknown',
        }));
    }, [sellers, buyers, locationIDToRegion]);

    const regionKeys = useMemo(() => {
        if (!locationsData) return [];
        return Object.keys(locationsData).filter(r => r !== 'all');
    }, [locationsData]);

    const marketHistoryRegions = useMemo(() => {
        if (!locationsData) return [];

        if (selectedRegion === 'all') {
            return Object.entries(locationsData).map(([regionName, region]) => ({
                regionID: region.regionID,
                name: regionName,
            }));
        }

        if (locationsData[selectedRegion]) {
            const region = locationsData[selectedRegion];
            return [{
                regionID: region.regionID,
                name: selectedRegion,
            }];
        }

        return [];
    }, [locationsData, selectedRegion]);

    const handleRegionFromDistribution = (region) => {
        setSelectedRegion(region);
        setActiveTab('orders');
    };

    const handleItemSelect = (item) => {
        setSelectedItem(item);
    };

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
                        onItemSelect={handleItemSelect}
                        marketTree={marketTree}
                        searchTerm={searchTerm}
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

                            <div className="market-tabs">
                                <button
                                    className={activeTab === 'orders' ? 'active' : ''}
                                    onClick={() => setActiveTab('orders')}
                                >
                                    Market Orders
                                </button>
                                <button
                                    className={activeTab === 'history' ? 'active' : ''}
                                    onClick={() => setActiveTab('history')}
                                >
                                    Market History
                                </button>
                                <button
                                    className={activeTab === 'distribution' ? 'active' : ''}
                                    onClick={() => setActiveTab('distribution')}
                                >
                                    Market Distribution
                                </button>
                            </div>

                            {activeTab === 'orders' && (
                                <MarketTables
                                    sellers={sellers}
                                    buyers={buyers}
                                    locationsData={locationsData}
                                    activeTab={activeTab}
                                    setActiveTab={setActiveTab}
                                    itemName={selectedItem?.typeName}
                                />
                            )}

                            {activeTab === 'history' && (
                                marketHistoryRegions.length > 0 ? (
                                    <MarketHistory itemId={selectedItem?.typeID} locationsData={locationsData} />
                                ) : (
                                    <div className="market-history">
                                        <p>No region data available for market history.</p>
                                    </div>
                                )
                            )}

                            {activeTab === 'distribution' && (
                                <MarketDistribution
                                    orders={allOrdersWithRegion}
                                    regions={regionKeys}
                                    onRegionClick={handleRegionFromDistribution}
                                    selectedRegion={selectedRegion}
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
