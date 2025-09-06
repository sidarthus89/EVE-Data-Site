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
    const [endIndex, setEndIndex] = useState(30); // Changed: Set to 30 initially instead of 0
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const sliderRef = useRef(null);
    const viewportRef = useRef(null);
    const dragState = useRef({
        type: null,
        startX: 0,
        initialStartIndex: 0,
        initialEndIndex: 0,
    });

    // Load market history when component mounts or item/region changes
    useEffect(() => {
        if (!selectedItem) {
            setHistoryData([]);
            setError('No item selected');
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        async function loadMarketHistory() {
            try {
                let data;
                const isAllRegions = !selectedRegion || selectedRegion.regionID === 'all';

                if (isAllRegions) {
                    // Use Azure Functions to get aggregated universe history
                    console.log('📊 Loading universe market history for:', selectedItem.typeName);
                    data = await fetchUniverseMarketHistory(selectedItem.typeID);
                } else {
                    // Get specific region history
                    console.log('📊 Loading region market history for:', selectedItem.typeName, 'Region:', selectedRegion.regionName);
                    data = await fetchMarketHistory(selectedItem.typeID, selectedRegion.regionID);
                }

                if (cancelled) return;

                setHistoryData(data || []);
                console.log('📊 Market history loaded:', {
                    dataLength: data?.length || 0,
                    isAllRegions,
                    region: selectedRegion?.regionName || 'All Regions'
                });

                // Set default to show all data
                const defaultStart = 0;
                const defaultEnd = data?.length || 0;

                setStartIndex(defaultStart);
                setEndIndex(defaultEnd);
            } catch (error) {
                if (cancelled) return;
                console.error('❌ Failed to load market history:', error);
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

    function handleDragStart(e, type) {
        e.preventDefault(); // Added: Prevent default behavior
        e.stopPropagation();
        dragState.current = {
            type,
            startX: e.clientX,
            initialStartIndex: startIndex,
            initialEndIndex: endIndex,
        };

        // Added: Set cursor styles
        document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize';

        window.addEventListener('mousemove', handleDragging);
        window.addEventListener('mouseup', handleDragEnd);
    }

    function handleDragging(e) {
        if (!dragState.current.type || !sliderRef.current || historyData.length === 0) return;

        const deltaX = e.clientX - dragState.current.startX;
        const sliderWidth = sliderRef.current.offsetWidth;
        const deltaDays = Math.round((deltaX / sliderWidth) * historyData.length);

        let newStart = dragState.current.initialStartIndex;
        let newEnd = dragState.current.initialEndIndex;

        if (dragState.current.type === 'move') {
            // Move the entire selection window
            const windowSize = newEnd - newStart;
            newStart = Math.max(0, Math.min(historyData.length - windowSize, newStart + deltaDays));
            newEnd = newStart + windowSize;
        } else if (dragState.current.type === 'resize-left') {
            // Resize from the left edge - ensure minimum window of 1 day, maximum of 365 days
            newStart = Math.max(0, Math.min(newEnd - 1, newStart + deltaDays));
            // Ensure the window doesn't exceed 365 days
            if (newEnd - newStart > 365) {
                newStart = newEnd - 365;
            }
        } else if (dragState.current.type === 'resize-right') {
            // Resize from the right edge - ensure minimum window of 1 day, maximum of 365 days
            newEnd = Math.min(historyData.length, Math.max(newStart + 1, newEnd + deltaDays));
            // Ensure the window doesn't exceed 365 days
            if (newEnd - newStart > 365) {
                newEnd = newStart + 365;
            }
        }

        setStartIndex(newStart);
        setEndIndex(newEnd);
    }

    function handleDragEnd() {
        // Reset cursor
        document.body.style.cursor = '';

        window.removeEventListener('mousemove', handleDragging);
        window.removeEventListener('mouseup', handleDragEnd);
        dragState.current = { type: null, startX: 0, initialStartIndex: 0, initialEndIndex: 0 };
    }

    // Loading state
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
                    <div>Loading universe market history...</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        Item: {selectedItem?.typeName || 'Unknown'}
                    </div>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
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
                    <div style={{ color: '#ff6b6b' }}>Error loading universe market history</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        {error}
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.5, marginTop: '10px' }}>
                        Debug: Item={selectedItem?.typeName}
                    </div>
                </div>
            </div>
        );
    }

    // No data state
    if (!historyData.length) {
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
                    <div>No market history available</div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '10px' }}>
                        This could be due to:
                    </div>
                    <ul style={{ fontSize: '12px', opacity: 0.7, textAlign: 'left', marginTop: '5px' }}>
                        <li>Item not actively traded</li>
                        <li>API service unavailable</li>
                        <li>Network connectivity issues</li>
                        <li>Invalid item data</li>
                    </ul>
                    <div style={{ fontSize: '12px', opacity: 0.5, marginTop: '10px' }}>
                        Debug: Item={selectedItem?.typeName}
                    </div>
                </div>
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
            <div style={{ color: '#fff', marginBottom: '10px', fontSize: '12px' }}>
                Market History: {selectedItem?.typeName} - {regionDisplayName} |
                Showing {visibleData.length} of {historyData.length} days |
                Range: {safeStartIndex}-{safeEndIndex}
                {historyData.length < 7 && historyData.length > 0 && (
                    <span style={{ color: '#ffa500', marginLeft: '10px' }}>
                        ⚠️ Limited market data available ({historyData.length} day{historyData.length === 1 ? '' : 's'})
                    </span>
                )}
                {historyData.length === 0 && (
                    <span style={{ color: '#ff6b6b', marginLeft: '10px' }}>
                        ❌ No market history data available
                    </span>
                )}
            </div>

            <ResponsiveContainer width="100%" height={380}>
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
                        tickFormatter={(value) => value ? value.toLocaleString() : ''}
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
                        tickFormatter={(value) => value ? value.toLocaleString() : ''}
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