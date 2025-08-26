import React, { useState, useEffect } from 'react';
import './StationTrading.css';
import { getSecurityColor, getStationInfo } from '../../utils/common.js';

const initialForm = {
    stationID: '',
    minProfit: 1000,
    minVolume: 1000,
    marginAbove: 20,
    marginBelow: 40,
};

const tradeHubs = [
    'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    'Amarr VIII (Oris) - Emperor Family Academy',
    'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    'Rens VI - Moon 8 - Brutor Tribe Treasury',
    'Hek VIII - Moon 12 - Boundless Creation Factory',
];

export default function StationTrading({ marketTree }) {
    const [formData, setFormData] = useState(initialForm);
    const [stationQuery, setStationQuery] = useState('');
    const [stationList, setStationList] = useState([]);
    const [typeNameMap, setTypeNameMap] = useState({});
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    // Load market tree
    useEffect(() => {
        if (marketTree) {
            const { items } = flattenMarketTree(marketTree);
            const map = {};
            for (const item of items) {
                map[item.typeID] = item.typeName;
            }
            setTypeNameMap(map);
        }
    }, [marketTree]);

    // Load station data
    useEffect(() => {
        fetchLocations()
            .then(data => {
                const stations = [];
                Object.entries(data).forEach(([regionName, region]) => {
                    Object.values(region).forEach(constellation => {
                        Object.values(constellation).forEach(system => {
                            if (system.stations) {
                                Object.entries(system.stations).forEach(([stationID, station]) => {
                                    stations.push({
                                        stationID: parseInt(stationID),
                                        locationName: station.name,
                                        regionName,
                                    });
                                });
                            }
                        });
                    });
                });
                setStationList(stations);
            })
            .catch(err => console.error('Failed to load locations:', err));
    }, []);

    // Resolve station name to ID
    useEffect(() => {
        fetchLocations()
            .then(data => {
                const stations = [];

                Object.entries(data).forEach(([regionName, region]) => {
                    Object.entries(region).forEach(([constellationKey, constellation]) => {
                        if (typeof constellation !== 'object') return;

                        Object.entries(constellation).forEach(([systemKey, system]) => {
                            if (typeof system !== 'object' || !system.stations) return;

                            Object.entries(system.stations).forEach(([stationID, station]) => {
                                if (typeof station.locationName === 'string') {
                                    stations.push({
                                        stationID: parseInt(stationID),
                                        locationName: station.locationName,
                                        regionName,
                                    });
                                }
                            });
                        });
                    });
                });

                setStationList(stations);
            })
            .catch(err => console.error('Failed to load locations:', err));
    }, []);

    const filteredStations = stationList.filter(s =>
        typeof s.locationName === 'string' &&
        s.locationName.toLowerCase().includes(stationQuery.toLowerCase())
    );

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSearch = async () => {
        setLoading(true);
        try {
            const stationID = parseInt(formData.stationID);
            if (!stationID) return;

            const orders = await fetchOrdersByStation(stationID);
            const grouped = new Map();

            for (const { type_id, is_buy_order, price, volume_remain } of orders) {
                if (!grouped.has(type_id)) {
                    grouped.set(type_id, { buy: [], sell: [] });
                }
                grouped.get(type_id)[is_buy_order ? 'buy' : 'sell'].push({ price, volume: volume_remain });
            }

            const filtered = [];
            for (const [typeID, { buy, sell }] of grouped.entries()) {
                const bestBuy = Math.max(...buy.map(o => o.price), 0);
                for (const s of sell) {
                    if (s.price >= bestBuy) continue;

                    const margin = bestBuy - s.price;
                    const roi = (margin / s.price) * 100;
                    const volume = s.volume;

                    if (
                        margin >= parseFloat(formData.minProfit) &&
                        volume >= parseInt(formData.minVolume) &&
                        roi >= parseFloat(formData.marginAbove) &&
                        roi <= parseFloat(formData.marginBelow)
                    ) {
                        filtered.push({
                            typeID,
                            itemName: typeNameMap[typeID] ?? `Type ${typeID}`,
                            sellPrice: s.price,
                            buyPrice: bestBuy,
                            margin,
                            roi,
                            volume,
                        });
                    }
                }
            }

            setResults(filtered);
        } catch (err) {
            console.error('Failed to fetch station orders:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="station-trading-container">
            <h2 className="station-trading-title">📊 Station Arbitrage Scanner</h2>

            <div className="station-trading-form">
                <div className="form-group full-width">
                    <label htmlFor="stationQuery">📍 Station Name</label>
                    <input
                        type="text"
                        id="stationQuery"
                        name="stationQuery"
                        placeholder="Type or paste station name"
                        value={stationQuery}
                        onChange={(e) => setStationQuery(e.target.value)}
                        className="station-trading-input"
                    />
                    {stationQuery && filteredStations.length > 0 && (
                        <ul className="station-suggestions">
                            {filteredStations.slice(0, 5).map((s, idx) => (
                                <li
                                    key={idx}
                                    onClick={() => setStationQuery(s.locationName)}
                                    className="station-suggestion-item"
                                >
                                    {s.locationName} ({s.regionName})
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="form-group full-width">
                    <label>🛰️ Quick Select Trade Hubs</label>
                    <div className="station-trading-hub-buttons">
                        {tradeHubs.map((name, idx) => (
                            <button
                                key={idx}
                                className="station-trading-button"
                                onClick={() => setStationQuery(name)}
                            >
                                {name.split(' - ')[0]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="form-group">
                    <label htmlFor="minProfit">💰 Only Profit Above (ISK)</label>
                    <input
                        type="number"
                        id="minProfit"
                        name="minProfit"
                        value={formData.minProfit}
                        onChange={handleChange}
                        className="station-trading-input"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="minVolume">📦 Minimum Volume</label>
                    <input
                        type="number"
                        id="minVolume"
                        name="minVolume"
                        value={formData.minVolume}
                        onChange={handleChange}
                        className="station-trading-input"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="marginAbove">📈 ROI Above (%)</label>
                    <input
                        type="number"
                        id="marginAbove"
                        name="marginAbove"
                        value={formData.marginAbove}
                        onChange={handleChange}
                        className="station-trading-input"
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="marginBelow">📉 ROI Below (%)</label>
                    <input
                        type="number"
                        id="marginBelow"
                        name="marginBelow"
                        value={formData.marginBelow}
                        onChange={handleChange}
                        className="station-trading-input"
                    />
                </div>
            </div>

            <button onClick={handleSearch} className="station-trading-button">
                {loading ? 'Searching...' : '🔍 Search'}
            </button>

            {results.length > 0 && (
                <table className="station-trading-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Sell Price</th>
                            <th>Buy Price</th>
                            <th>Margin</th>
                            <th>ROI (%)</th>
                            <th>Volume</th>
                        </tr>
                    </thead>
                    <tbody>
                        {results.map((item, idx) => (
                            <tr key={idx}>
                                <td>{item.itemName}</td>
                                <td>{item.sellPrice.toFixed(2)}</td>
                                <td>{item.buyPrice.toFixed(2)}</td>
                                <td>{item.margin.toFixed(2)}</td>
                                <td>{item.roi.toFixed(2)}</td>
                                <td>{item.volume}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}