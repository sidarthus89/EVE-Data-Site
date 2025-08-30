// Enhanced MarketHistory component with comprehensive debugging

import React, { useEffect, useState, useRef } from 'react';
import {
    ComposedChart,
    Line,
    Bar,
    Area,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import { fetchMarketHistory, fetchUniverseMarketHistory } from '../../utils/market.js';

export default function MarketHistory({ selectedItem, selectedRegion, setActiveTab }) {
    const [historyData, setHistoryData] = useState([]);
    const [startIndex, setStartIndex] = useState(0);
    const [endIndex, setEndIndex] = useState(30); // Default to 30 days
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [debugInfo, setDebugInfo] = useState({});
    const [debugMode, setDebugMode] = useState(false);

    const sliderRef = useRef(null);
    const viewportRef = useRef(null);
    const dragState = useRef({
        type: null,
        startX: 0,
        initialStartIndex: 0,
        initialEndIndex: 0,
    });

    // Enhanced debugging function
    const logDebugInfo = (stage, data) => {
        const info = {
            stage,
            timestamp: new Date().toISOString(),
            selectedItem: selectedItem ? {
                typeID: selectedItem.typeID,
                typeName: selectedItem.typeName
            } : null,
            selectedRegion: selectedRegion ? {
                regionID: selectedRegion.regionID,
                regionName: selectedRegion.regionName
            } : null,
            dataLength: Array.isArray(data) ? data.length : 0,
            firstItem: Array.isArray(data) && data.length > 0 ? data[0] : null,
            lastItem: Array.isArray(data) && data.length > 0 ? data[data.length - 1] : null
        };

        console.log(`[MarketHistory Debug] ${stage}:`, info);
        setDebugInfo(prev => ({ ...prev, [stage]: info }));
        return info;
    };

    // Data transformation function to handle field name variations
    const transformData = (rawData) => {
        if (!Array.isArray(rawData) || rawData.length === 0) {
            console.log('[Transform] No data to transform');
            return [];
        }

        console.log('[Transform] Raw data sample:', rawData.slice(0, 3));

        return rawData.map((item, index) => {
            // Handle common field name variations
            let date = item.date || item.Date || item.timestamp || item.time || item.day;

            // If date is in YYYY-MM-DD format, convert to readable format
            if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}/)) {
                date = new Date(date).toLocaleDateString();
            } else if (typeof date === 'string' && date.includes('T')) {
                // Handle ISO date format
                date = new Date(date).toLocaleDateString();
            } else if (typeof date === 'number') {
                // Handle Unix timestamp
                date = new Date(date * 1000).toLocaleDateString();
            }

            const transformed = {
                date: date || `Day ${index + 1}`,
                average: Number(item.average || item.avg || item.price || item.avgPrice || item.averagePrice || 0),
                totalVolume: Number(item.totalVolume || item.volume || item.qty || item.quantity || item.vol || 0)
            };

            // Log first few transformations
            if (index < 3) {
                console.log(`[Transform] Item ${index}:`, {
                    original: item,
                    transformed
                });
            }

            return transformed;
        });
    };

    // Load market history when component mounts or item/region changes
    useEffect(() => {
        if (!selectedItem) {
            setHistoryData([]);
            setError('No item selected');
            logDebugInfo('NO_ITEM', []);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);
        setDebugInfo({});

        async function loadMarketHistory() {
            try {
                logDebugInfo('LOADING_START', []);

                let data;
                const isAllRegions = !selectedRegion || selectedRegion.regionID === 'all';

                if (isAllRegions) {
                    console.log('[API] Loading universe market history for:', selectedItem.typeName);
                    data = await fetchUniverseMarketHistory(selectedItem.typeID);
                } else {
                    console.log('[API] Loading region market history for:', selectedItem.typeName, 'Region:', selectedRegion.regionName);
                    data = await fetchMarketHistory(selectedItem.typeID, selectedRegion.regionID);
                }

                if (cancelled) return;

                // Enhanced data validation and logging
                const validatedData = Array.isArray(data) ? data : [];
                logDebugInfo('DATA_RECEIVED', validatedData);

                // Transform data to ensure correct field names
                const transformedData = transformData(validatedData);
                logDebugInfo('DATA_TRANSFORMED', transformedData);

                if (transformedData.length > 0) {
                    const firstItem = transformedData[0];
                    console.log('[Validation] Sample transformed data structure:', firstItem);

                    // Validate transformed data
                    const isValid = firstItem.date &&
                        typeof firstItem.average === 'number' &&
                        typeof firstItem.totalVolume === 'number' &&
                        !isNaN(firstItem.average) &&
                        !isNaN(firstItem.totalVolume);

                    if (!isValid) {
                        console.warn('[Validation] Transformed data validation failed:', firstItem);
                        setError('Data transformation failed - invalid format');
                        return;
                    }
                }

                setHistoryData(transformedData);

                // Set default to show all data
                const defaultStart = 0;
                const defaultEnd = transformedData.length || 0;

                setStartIndex(defaultStart);
                setEndIndex(defaultEnd);

                logDebugInfo('DATA_SET', transformedData);

            } catch (error) {
                if (cancelled) return;
                console.error('[Error] Failed to load market history:', error);
                logDebugInfo('ERROR', []);
                setError(error.message || 'Failed to load market history');
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadMarketHistory();

        return () => {
            cancelled = true;
        };
    }, [selectedItem, selectedRegion]);

    // Enhanced data analysis logging
    useEffect(() => {
        console.log('[Data Analysis] DETAILED DATA ANALYSIS:', {
            dataLength: historyData.length,
            firstItem: historyData[0],
            lastItem: historyData[historyData.length - 1],
            sampleStructure: historyData.slice(0, 3).map(item => ({
                keys: Object.keys(item || {}),
                dateType: typeof item?.date,
                dateValue: item?.date,
                averageType: typeof item?.average,
                averageValue: item?.average,
                volumeType: typeof item?.totalVolume,
                volumeValue: item?.totalVolume
            })),
            hasRequiredFields: historyData.length > 0 ? {
                hasDate: 'date' in (historyData[0] || {}),
                hasAverage: 'average' in (historyData[0] || {}),
                hasVolume: 'totalVolume' in (historyData[0] || {})
            } : null,
            dataValidation: historyData.slice(0, 5).map(item => ({
                isValid: item && typeof item.date === 'string' &&
                    typeof item.average === 'number' &&
                    typeof item.totalVolume === 'number' &&
                    !isNaN(item.average) &&
                    !isNaN(item.totalVolume),
                item
            }))
        });

        // Check for common field name variations in original data
        if (historyData.length > 0) {
            const firstItem = historyData[0];
            const possibleFields = Object.keys(firstItem);
            console.log('[Field Analysis] AVAILABLE FIELDS:', possibleFields);

            // Check for common variations
            const dateFields = possibleFields.filter(field =>
                field.toLowerCase().includes('date') ||
                field.toLowerCase().includes('time'));
            const priceFields = possibleFields.filter(field =>
                field.toLowerCase().includes('price') ||
                field.toLowerCase().includes('avg') ||
                field.toLowerCase().includes('average'));
            const volumeFields = possibleFields.filter(field =>
                field.toLowerCase().includes('volume') ||
                field.toLowerCase().includes('quantity'));

            console.log('[Field Analysis] FIELD ANALYSIS:', {
                dateFields,
                priceFields,
                volumeFields
            });
        }
    }, [historyData]);

    // Log the request parameters for debugging
    useEffect(() => {
        console.log('[Request] Requesting market history with:', {
            type_id: selectedItem?.typeID,
            region_id: selectedRegion?.regionID
        });
    }, [selectedItem, selectedRegion]);

    function handleDragStart(e, type) {
        e.preventDefault();
        e.stopPropagation();
        dragState.current = {
            type,
            startX: e.clientX,
            initialStartIndex: startIndex,
            initialEndIndex: endIndex,
        };

        document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize';

        window.addEventListener('mousemove', handleDragging);
        window.addEventListener('mouseup', handleDragEnd);
    }

    // Ensure dragging respects the 365-day limit
    function handleDragging(e) {
        if (!dragState.current.type || !sliderRef.current || historyData.length === 0) return;

        const deltaX = e.clientX - dragState.current.startX;
        const sliderWidth = sliderRef.current.offsetWidth;
        const deltaDays = Math.round((deltaX / sliderWidth) * historyData.length);

        let newStart = dragState.current.initialStartIndex;
        let newEnd = dragState.current.initialEndIndex;

        if (dragState.current.type === 'move') {
            const windowSize = newEnd - newStart;
            newStart = Math.max(0, Math.min(historyData.length - windowSize, newStart + deltaDays));
            newEnd = newStart + windowSize;
        } else if (dragState.current.type === 'resize-left') {
            newStart = Math.max(0, Math.min(newEnd - 1, newStart + deltaDays));
            if (newEnd - newStart > 365) {
                newStart = newEnd - 365;
            }
        } else if (dragState.current.type === 'resize-right') {
            newEnd = Math.min(historyData.length, Math.max(newStart + 1, newEnd + deltaDays));
            if (newEnd - newStart > 365) {
                newEnd = newStart + 365;
            }
        }

        setStartIndex(newStart);
        setEndIndex(newEnd);
    }

    function handleDragEnd() {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', handleDragging);
        window.removeEventListener('mouseup', handleDragEnd);
        dragState.current = { type: null, startX: 0, initialStartIndex: 0, initialEndIndex: 0 };
    }

    // Loading state with enhanced debug info
    if (loading) {
        return (
            <div style={{
                width: '100%',
                height: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid #333'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div>Loading market history...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        Item: {selectedItem?.typeName || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '5px' }}>
                        Region: {selectedRegion?.regionName || 'All Regions'}
                    </div>
                </div>
            </div>
        );
    }

    // Error state with enhanced debug info
    if (error) {
        return (
            <div style={{
                width: '100%',
                height: 500,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid #333',
                padding: '20px'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <div style={{ color: '#ff6b6b' }}>Error loading market history</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        {error}
                    </div>
                </div>

                <button
                    onClick={() => setDebugMode(!debugMode)}
                    style={{ background: '#444', color: '#fff', padding: '10px', margin: '10px', border: 'none', borderRadius: '4px' }}
                >
                    {debugMode ? 'Hide' : 'Show'} Debug Info
                </button>

                {debugMode && debugInfo && (
                    <div style={{ color: '#ffa500', marginBottom: '10px', maxWidth: '80%', overflow: 'auto' }}>
                        <strong>Debug Information:</strong>
                        <pre style={{ fontSize: '10px', textAlign: 'left' }}>
                            {JSON.stringify(debugInfo, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        );
    }

    // No data state with debug info
    if (!historyData.length) {
        return (
            <div style={{
                width: '100%',
                height: 500,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid #333',
                padding: '20px'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                    <div>No market history available</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        This could be due to:
                    </div>
                    <ul style={{ fontSize: '12px', opacity: 0.7, textAlign: 'left', marginTop: '5px' }}>
                        <li>Item not actively traded</li>
                        <li>API service returned empty data</li>
                        <li>Data format mismatch</li>
                        <li>Network connectivity issues</li>
                    </ul>
                </div>

                <button
                    onClick={() => setDebugMode(!debugMode)}
                    style={{ background: '#444', color: '#fff', padding: '10px', margin: '10px', border: 'none', borderRadius: '4px' }}
                >
                    {debugMode ? 'Hide' : 'Show'} Debug Info
                </button>

                {debugMode && debugInfo && (
                    <div style={{ color: '#ffa500', marginBottom: '10px', maxWidth: '80%', overflow: 'auto' }}>
                        <strong>Debug Information:</strong>
                        <pre style={{ fontSize: '10px', textAlign: 'left' }}>
                            {JSON.stringify(debugInfo, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        );
    }

    // Fixed: Ensure indices are valid before slicing
    const safeStartIndex = Math.max(0, Math.min(startIndex, historyData.length - 1));
    const safeEndIndex = Math.max(safeStartIndex + 1, Math.min(endIndex, historyData.length));
    const visibleData = historyData.slice(safeStartIndex, safeEndIndex);

    const isAllRegions = !selectedRegion || selectedRegion.regionID === 'all';
    const regionDisplayName = isAllRegions ? 'All Regions (Universe)' : selectedRegion.regionName;

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{
                    backgroundColor: '#2a2a2a',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    padding: '10px',
                    color: '#fff'
                }}>
                    <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{label}</p>
                    {payload.map((entry, index) => (
                        <p key={index} style={{
                            margin: '2px 0',
                            color: entry.color,
                            fontSize: '12px'
                        }}>
                            {entry.name}: {entry.value?.toLocaleString() || 'N/A'}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{
            width: '100%',
            height: 500,
            background: '#1a1a1a',
            border: '1px solid #333',
            padding: '10px'
        }}>
            <div style={{ color: '#fff', marginBottom: '10px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    Market History: {selectedItem?.typeName} - {regionDisplayName} |
                    Showing {visibleData.length} of {historyData.length} days |
                    Range: {safeStartIndex}-{safeEndIndex}

                    <span style={{ color: '#00ff00', marginLeft: '20px' }}>
                        [Debug: Chart should render with {visibleData.length} data points]
                    </span>

                    {historyData.length < 7 && historyData.length > 0 && (
                        <span style={{ color: '#ffa500', marginLeft: '10px' }}>
                            Limited market data available ({historyData.length} day{historyData.length === 1 ? '' : 's'})
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={() => console.log('[Raw Data Sample]', historyData.slice(0, 5))}
                        style={{ background: '#444', color: '#fff', padding: '5px 10px', border: 'none', borderRadius: '4px', fontSize: '10px' }}
                    >
                        Log Raw Data
                    </button>
                    <button
                        onClick={() => console.log('[Visible Data Sample]', visibleData.slice(0, 5))}
                        style={{ background: '#444', color: '#fff', padding: '5px 10px', border: 'none', borderRadius: '4px', fontSize: '10px' }}
                    >
                        Log Visible Data
                    </button>
                </div>
            </div>

            {/* Enhanced chart with debugging */}
            <ResponsiveContainer width="100%" height={380}>
                {(() => {
                    console.log('[Chart Render] RENDERING CHART WITH:', {
                        dataLength: visibleData.length,
                        firstPoint: visibleData[0],
                        lastPoint: visibleData[visibleData.length - 1],
                        allDataValid: visibleData.every(item =>
                            item &&
                            typeof item.date === 'string' &&
                            typeof item.average === 'number' &&
                            typeof item.totalVolume === 'number' &&
                            !isNaN(item.average) &&
                            !isNaN(item.totalVolume)
                        )
                    });
                    return (
                        <ComposedChart
                            data={visibleData}
                            margin={{ top: 20, right: 50, left: 50, bottom: 50 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                            <XAxis
                                dataKey="date"
                                angle={-45}
                                textAnchor="end"
                                interval={Math.max(0, Math.floor(visibleData.length / 10))}
                                stroke="#ccc"
                                fontSize={10}
                            />
                            <YAxis
                                yAxisId="left"
                                label={{
                                    value: 'Avg Price (ISK)',
                                    angle: -90,
                                    position: 'insideLeft',
                                    style: { textAnchor: 'middle' }
                                }}
                                tickFormatter={(value) => value ? value.toLocaleString() : '0'}
                                domain={['auto', 'auto']}
                                stroke="#1f77b4"
                                fontSize={10}
                            />
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                label={{
                                    value: 'Volume',
                                    angle: 90,
                                    position: 'insideRight',
                                    style: { textAnchor: 'middle' }
                                }}
                                tickFormatter={(value) => value ? value.toLocaleString() : '0'}
                                domain={[0, 'auto']}
                                stroke="#8884d8"
                                fontSize={10}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Legend
                                verticalAlign="top"
                                height={36}
                                wrapperStyle={{ color: '#fff', fontSize: '12px' }}
                            />
                            <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="average"
                                stroke="#1f77b4"
                                strokeWidth={2}
                                dot={false}
                                name="Average Price"
                            />
                            <Bar
                                yAxisId="right"
                                dataKey="totalVolume"
                                fill="#8884d8"
                                barSize={Math.max(1, Math.min(20, 300 / visibleData.length))}
                                opacity={0.4}
                                name="Volume"
                            />
                        </ComposedChart>
                    );
                })()}
            </ResponsiveContainer>

            {/* Timeline Slider */}
            <div
                ref={sliderRef}
                style={{
                    position: 'relative',
                    height: 60,
                    marginTop: 10,
                    background: '#555',
                    border: '1px solid #666',
                    overflow: 'hidden',
                    userSelect: 'none',
                }}
            >
                {/* Mini Chart Layer */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={historyData}>
                            <Area
                                type="monotone"
                                dataKey="totalVolume"
                                stroke="#8884d8"
                                fill="#8884d8"
                                opacity={0.3}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* Viewport Overlay */}
                <div
                    ref={viewportRef}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: `${(safeStartIndex / historyData.length) * 100}%`,
                        width: `${((safeEndIndex - safeStartIndex) / historyData.length) * 100}%`,
                        height: '100%',
                        background: 'rgba(100, 149, 237, 0.3)',
                        border: '2px solid #6495ED',
                        borderRadius: 4,
                        boxShadow: '0 0 4px rgba(0,0,0,0.2)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: dragState.current.type === 'move' ? 'grabbing' : 'grab',
                        zIndex: 2,
                        transition: dragState.current.type ? 'none' : 'all 0.1s ease',
                    }}
                    onMouseDown={(e) => handleDragStart(e, 'move')}
                >
                    {/* Left Resize Handle */}
                    <div
                        style={{
                            width: 8,
                            height: '100%',
                            cursor: 'ew-resize',
                            background: '#6495ED',
                            borderRadius: '4px 0 0 4px',
                            transition: 'background-color 0.2s ease',
                        }}
                        onMouseDown={(e) => handleDragStart(e, 'resize-left')}
                        onMouseEnter={(e) => e.target.style.backgroundColor = '#4169E1'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = '#6495ED'}
                    />

                    {/* Scope Counter */}
                    <div style={{
                        position: 'absolute',
                        top: 4,
                        right: 8,
                        background: 'rgba(0,0,0,0.8)',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 12,
                        pointerEvents: 'none'
                    }}>
                        {safeEndIndex - safeStartIndex}d
                    </div>

                    {/* Right Resize Handle */}
                    <div
                        style={{
                            width: 8,
                            height: '100%',
                            cursor: 'ew-resize',
                            background: '#6495ED',
                            borderRadius: '0 4px 4px 0',
                            transition: 'background-color 0.2s ease',
                        }}
                        onMouseDown={(e) => handleDragStart(e, 'resize-right')}
                        onMouseEnter={(e) => e.target.style.backgroundColor = '#4169E1'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = '#6495ED'}
                    />
                </div>
            </div>
        </div>
    );
}