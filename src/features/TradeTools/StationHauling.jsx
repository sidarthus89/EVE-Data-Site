// src/features/TradeTools/StationHauling.jsx
import React, { useState, useEffect } from 'react';
import './StationHauling.css';

const INITIAL_FORM = {
    fromStations: [],
    toStations: [],
    minProfit: 500000,
    maxWeight: '',
    minROI: 4,
    minVolume: 1000,
    maxJumps: '',
    salesTax: 7.5,
    brokersFee: 5,
    hideOutOfStock: false
};

export default function StationHauling() {
    const [formData, setFormData] = useState(INITIAL_FORM);
    const [fromInput, setFromInput] = useState('');
    const [toInput, setToInput] = useState('');
    const [resources, setResources] = useState(null);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]);
    const [error, setError] = useState(null);

    // Load EVE-Trade resources on mount
    useEffect(() => {
        const loadResources = async () => {
            try {
                const resourceData = await fetchEveTradeResources();
                setResources(resourceData);
            } catch (err) {
                console.error('Failed to load EVE-Trade resources:', err);
                setError('Failed to load station data. Please refresh the page.');
            }
        };

        loadResources();
    }, []);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const addStationToList = (locationName, listType) => {
        if (!resources?.universeList) return;

        const cleanlocationName = locationName.replace('*', '');
        const stationData = resources.universeList[cleanlocationName.toLowerCase()];

        if (!stationData) {
            console.warn('Station not found:', cleanlocationName);
            return;
        }

        const listField = listType === 'from' ? 'fromStations' : 'toStations';
        const currentList = formData[listField];

        // Check if station already exists
        if (currentList.some(station => station.station === stationData.station)) {
            return;
        }

        const newStation = {
            name: cleanlocationName,
            region: stationData.region,
            system: stationData.system,
            station: stationData.station
        };

        handleInputChange(listField, [...currentList, newStation]);
    };

    const removeStationFromList = (stationId, listType) => {
        const listField = listType === 'from' ? 'fromStations' : 'toStations';
        const currentList = formData[listField];
        handleInputChange(listField, currentList.filter(station => station.station !== stationId));
    };

    const addSystemToList = (stationData, listType) => {
        const systemName = utils.getSystemFromStation(stationData.name);
        // In a real implementation, you'd need to get all stations in the system
        // For now, just add the system name as a station
        addStationToList(systemName, listType);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // Build API request parameters
            const fromStationIds = formData.fromStations.map(s => s.station).join(',');
            const toStationIds = formData.toStations.map(s => s.station).join(',');

            if (!fromStationIds || !toStationIds) {
                throw new Error('Please select at least one starting and ending station.');
            }

            const params = {
                from: `sell-${fromStationIds}`,
                to: `buy-${toStationIds}`,
                minProfit: formData.minProfit,
                minROI: formData.minROI,
                minVolume: formData.minVolume,
                salesTax: formData.salesTax,
                brokersFee: formData.brokersFee,
                hideOutOfStock: formData.hideOutOfStock ? 'true' : 'false'
            };

            // Add optional parameters
            if (formData.maxWeight) params.maxWeight = formData.maxWeight;
            if (formData.maxJumps) params.maxJumps = formData.maxJumps;

            const data = await fetchStationHaulingData(params);
            setResults(data.result || []);
        } catch (err) {
            console.error('Hauling search failed:', err);
            setError(err.message || 'Failed to fetch hauling data. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const StationList = ({ stations, listType, title }) => (
        <div className="station-list-container">
            <h4>{title}</h4>
            <div className="station-list">
                {stations.length === 0 ? (
                    <p className="empty-list">No stations selected</p>
                ) : (
                    stations.map((station) => (
                        <div key={station.station} className="station-item">
                            <span className="station-name">{station.name}</span>
                            <button
                                type="button"
                                className="add-system-btn"
                                onClick={() => addSystemToList(station, listType)}
                                title="Add entire system"
                            >
                                Add System
                            </button>
                            <button
                                type="button"
                                className="remove-btn"
                                onClick={() => removeStationFromList(station.station, listType)}
                                title="Remove station"
                            >
                                ×
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const TradeHubSuggestions = ({ onAddStation, listType }) => (
        <div className="trade-hub-suggestions">
            <span>Trade Hubs: </span>
            {utils.tradeHubs.map((hub, index) => (
                <React.Fragment key={hub}>
                    <button
                        type="button"
                        className="hub-suggestion"
                        onClick={() => onAddStation(hub, listType)}
                    >
                        {hub.split(' ')[0]} {/* Show just the first word (Jita, Amarr, etc.) */}
                    </button>
                    {index < utils.tradeHubs.length - 1 && ' | '}
                </React.Fragment>
            ))}
        </div>
    );

    if (!resources) {
        return (
            <div className="station-hauling">
                <div className="loading-container">
                    <p>Loading station data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="station-hauling">
            <div className="page-header">
                <h1>Station to Station Trading</h1>
                <p>Find the most profitable trade routes between specific stations.</p>
                <p className="disclaimer">Orders change frequently. Profit is not guaranteed. Verify prices are accurate.</p>
            </div>

            {!results.length ? (
                <div className="hauling-form">
                    <form onSubmit={handleSubmit}>
                        <div className="form-row">
                            <div className="form-column">
                                <label htmlFor="fromInput">Starting Station(s)</label>
                                <input
                                    id="fromInput"
                                    type="text"
                                    value={fromInput}
                                    onChange={(e) => setFromInput(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            if (fromInput.trim()) {
                                                addStationToList(fromInput.trim(), 'from');
                                                setFromInput('');
                                            }
                                        }
                                    }}
                                    placeholder="Station Name"
                                    className="form-control"
                                />
                                <TradeHubSuggestions onAddStation={addStationToList} listType="from" />
                            </div>

                            <div className="form-column">
                                <label htmlFor="toInput">Ending Station(s)</label>
                                <input
                                    id="toInput"
                                    type="text"
                                    value={toInput}
                                    onChange={(e) => setToInput(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            if (toInput.trim()) {
                                                addStationToList(toInput.trim(), 'to');
                                                setToInput('');
                                            }
                                        }
                                    }}
                                    placeholder="Station Name"
                                    className="form-control"
                                />
                                <TradeHubSuggestions onAddStation={addStationToList} listType="to" />
                            </div>
                        </div>

                        <div className="form-row">
                            <StationList
                                stations={formData.fromStations}
                                listType="from"
                                title="Starting Station(s)"
                            />
                            <StationList
                                stations={formData.toStations}
                                listType="to"
                                title="Ending Station(s)"
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="minProfit">Only Profit Above</label>
                                <input
                                    id="minProfit"
                                    type="number"
                                    value={formData.minProfit}
                                    onChange={(e) => handleInputChange('minProfit', Number(e.target.value))}
                                    placeholder="500,000"
                                    className="form-control"
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="maxWeight">Cargo Capacity</label>
                                <input
                                    id="maxWeight"
                                    type="number"
                                    value={formData.maxWeight}
                                    onChange={(e) => handleInputChange('maxWeight', e.target.value)}
                                    placeholder="Infinity"
                                    className="form-control"
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="minROI">Return on Investment (%)</label>
                                <input
                                    id="minROI"
                                    type="number"
                                    value={formData.minROI}
                                    onChange={(e) => handleInputChange('minROI', Number(e.target.value))}
                                    placeholder="4"
                                    className="form-control"
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="minVolume">Minimum Volume</label>
                                <input
                                    id="minVolume"
                                    type="number"
                                    value={formData.minVolume}
                                    onChange={(e) => handleInputChange('minVolume', Number(e.target.value))}
                                    placeholder="1,000"
                                    className="form-control"
                                />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="salesTax">Sales Tax (%)</label>
                                <input
                                    id="salesTax"
                                    type="number"
                                    step="0.1"
                                    value={formData.salesTax}
                                    onChange={(e) => handleInputChange('salesTax', Number(e.target.value))}
                                    className="form-control"
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="brokersFee">Brokers Fee (%)</label>
                                <input
                                    id="brokersFee"
                                    type="number"
                                    step="0.1"
                                    value={formData.brokersFee}
                                    onChange={(e) => handleInputChange('brokersFee', Number(e.target.value))}
                                    className="form-control"
                                />
                            </div>

                            <div className="form-group checkbox-group">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={formData.hideOutOfStock}
                                        onChange={(e) => handleInputChange('hideOutOfStock', e.target.checked)}
                                    />
                                    Hide Out of Stock
                                </label>
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
                                disabled={loading || formData.fromStations.length === 0 || formData.toStations.length === 0}
                                className="submit-btn"
                            >
                                {loading ? 'Searching...' : 'Find Trade Routes'}
                            </button>
                        </div>
                    </form>
                </div>
            ) : (
                <div className="results-container">
                    <div className="results-header">
                        <h2>Trade Route Results</h2>
                        <button
                            onClick={() => {
                                setResults([]);
                                setError(null);
                            }}
                            className="new-search-btn"
                        >
                            New Search
                        </button>
                    </div>

                    {results.length === 0 ? (
                        <p>No profitable trade routes found with the current parameters.</p>
                    ) : (
                        <div className="results-table-container">
                            <table className="results-table">
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th>From</th>
                                        <th>To</th>
                                        <th>Buy Price</th>
                                        <th>Sell Price</th>
                                        <th>Profit</th>
                                        <th>ROI %</th>
                                        <th>Volume</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((result, index) => {
                                        // Get station info for security color coding
                                        const fromStationInfo = getStationInfo(result.fromStationID, resources?.universeList);
                                        const toStationInfo = getStationInfo(result.toStationID, resources?.universeList);

                                        return (
                                            <tr key={index}>
                                                <td>{result.itemName || result.typeID}</td>
                                                <td>
                                                    <span
                                                        className="station-cell"
                                                        style={{
                                                            color: fromStationInfo?.security ? getSecurityColor(fromStationInfo.security) : '#ffffff'
                                                        }}
                                                    >
                                                        {result.fromStation}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        className="station-cell"
                                                        style={{
                                                            color: toStationInfo?.security ? getSecurityColor(toStationInfo.security) : '#ffffff'
                                                        }}
                                                    >
                                                        {result.toStation}
                                                    </span>
                                                </td>
                                                <td>{utils.formatNumber(result.buyPrice)}</td>
                                                <td>{utils.formatNumber(result.sellPrice)}</td>
                                                <td>{utils.formatNumber(result.profit)}</td>
                                                <td>{utils.formatNumber(result.roi, 1)}%</td>
                                                <td>{utils.formatNumber(result.volume, 0)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
