import React, { useMemo, useEffect } from 'react';
import {
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

export default function MarketDistribution({
    orders = [],
    regions = [],
    onRegionClick,
    selectedRegion
}) {
    if (selectedRegion?.regionID !== 'all') {
        return (
            <div style={{
                width: '100%',
                height: 400,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid #333'
            }}>
                <p>Market distribution chart is only available when "All Regions" is selected.</p>
                <p style={{ marginTop: '10px', fontSize: '0.9em', opacity: 0.7 }}>
                    Current selection: {selectedRegion?.regionName || 'None'}
                </p>
                <p style={{ marginTop: '10px', fontSize: '0.9em', opacity: 0.7 }}>
                    Select "All Regions" from the region dropdown to view market distribution across regions.
                </p>
            </div>
        );
    }

    const filteredOrders = useMemo(() => {
        if (!orders || orders.length === 0) {
            return [];
        }

        const prices = orders
            .map(order => order.price)
            .filter(price => price > 0 && !isNaN(price));

        if (prices.length === 0) {
            return [];
        }

        prices.sort((a, b) => a - b);

        const p1Index = Math.floor(prices.length * 0.01);
        const p99Index = Math.floor(prices.length * 0.99);
        const lowerBoundIndex = Math.max(0, p1Index);
        const upperBoundIndex = Math.min(prices.length - 1, p99Index);
        const lowerBound = prices[lowerBoundIndex];
        const upperBound = prices[upperBoundIndex];

        const filtered = orders.filter(order => {
            const price = order.price;
            const volume = order.volume_remain;
            const hasValidPrice = price >= lowerBound && price <= upperBound;
            const hasValidVolume = volume > 0;
            const hasRegion = order.regionName && order.regionName !== 'Unknown';

            return hasValidPrice && hasValidVolume && hasRegion;
        });

        return filtered;
    }, [orders]);

    const data = useMemo(() => {

        if (!regions || regions.length === 0) {
            return [];
        }

        const regionMap = {};
        regions.forEach(region => {
            const regionName = region.regionName || region.name;
            if (regionName) {
                regionMap[regionName] = {
                    region: regionName,
                    buyerVolume: 0,
                    sellerVolume: 0,
                    buyerCount: 0,
                    sellerCount: 0
                };
            }
        });

        filteredOrders.forEach(order => {
            const regionName = order.regionName;

            if (!regionMap[regionName]) {
                regionMap[regionName] = {
                    region: regionName,
                    buyerVolume: 0,
                    sellerVolume: 0,
                    buyerCount: 0,
                    sellerCount: 0
                };
            }

            const entry = regionMap[regionName];
            if (order.is_buy_order) {
                entry.buyerVolume += order.volume_remain || 0;
                entry.buyerCount += 1;
            } else {
                entry.sellerVolume += order.volume_remain || 0;
                entry.sellerCount += 1;
            }
        });

        // Convert to array and sort alphabetically
        const chartData = Object.values(regionMap).sort((a, b) => {
            return a.region.localeCompare(b.region);
        });

        return chartData;
    }, [filteredOrders, regions]);

    useEffect(() => {
        if (data.length > 0) {
            console.log('📊 Top 3 regions by volume:',
                data.slice(0, 3).map(d => ({
                    region: d.region,
                    totalVolume: d.buyerVolume + d.sellerVolume,
                    sellers: d.sellerVolume,
                    buyers: d.buyerVolume
                }))
            );
        }

        // Check for common issues
        if (orders.length > 0 && filteredOrders.length === 0) {
        }

        if (filteredOrders.length > 0 && data.length === 0) {
            console.log('⚠️ ISSUE: Filtered orders exist but no chart data generated');
            console.log('Available region names in orders:',
                [...new Set(filteredOrders.map(o => o.regionName))]);
            console.log('Available region names in regions:',
                regions.map(r => r.regionName || r.name));
        }
    }, [data, orders, filteredOrders, regions]);

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
                            {entry.name}: {entry.value?.toLocaleString() || 0}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    const legendPayload = [
        { value: 'Seller Volume (Supply)', type: 'rect', color: '#2ca02c', id: 'sellerVolume' },
        { value: 'Buyer Volume (Demand)', type: 'line', color: '#ff7f0e', id: 'buyerVolume' }
    ];

    const handleBarClick = (data) => {
        if (onRegionClick && data?.region) {
            onRegionClick(data.region);
        }
    };

    // Show loading/no data state
    if (!data || data.length === 0) {
        return (
            <div style={{
                width: '100%',
                height: 400,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid #333'
            }}>
                <h3>No Market Data Available</h3>
                <div style={{ textAlign: 'left', fontSize: '12px', opacity: 0.7, marginTop: '20px' }}>
                    <p>Debug Info:</p>
                    <p>• Raw orders: {orders?.length || 0}</p>
                    <p>• Filtered orders: {filteredOrders.length}</p>
                    <p>• Regions: {regions?.length || 0}</p>
                    <p>• Chart data points: {data.length}</p>
                    {filteredOrders.length > 0 && (
                        <p>• Sample order region: {filteredOrders[0]?.regionName || 'Unknown'}</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div style={{
            width: '100%',
            height: 400,
            background: '#1a1a1a',
            border: '1px solid #333',
            padding: '10px'
        }}>
            <div style={{ color: '#fff', marginBottom: '10px', fontSize: '12px' }}>
                Showing data for {data.length} regions with market activity
            </div>
            <ResponsiveContainer width="100%" height="90%">
                <ComposedChart
                    data={data}
                    margin={{ top: 20, right: 50, left: 50, bottom: 80 }}
                >
                    <XAxis
                        dataKey="region"
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                        height={100}
                        fontSize={10}
                        stroke="#ccc"
                    />
                    <YAxis
                        yAxisId="left"
                        orientation="left"
                        stroke="#2ca02c"
                        fontSize={10}
                        label={{
                            value: 'Seller Volume (Supply)',
                            angle: -90,
                            position: 'insideLeft',
                            style: { textAnchor: 'middle' }
                        }}
                    />
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#ff7f0e"
                        fontSize={10}
                        label={{
                            value: 'Buyer Volume (Demand)',
                            angle: 90,
                            position: 'insideRight',
                            style: { textAnchor: 'middle' }
                        }}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                        payload={legendPayload}
                        verticalAlign="top"
                        height={36}
                        wrapperStyle={{ color: '#fff', fontSize: '12px' }}
                    />

                    {/* Seller volume as green bars */}
                    <Bar
                        yAxisId="left"
                        dataKey="sellerVolume"
                        fill="#2ca02c"
                        name="Seller Volume (Supply)"
                        onClick={handleBarClick}
                        cursor="pointer"
                    />

                    {/* Buyer volume as orange line */}
                    <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="buyerVolume"
                        stroke="#ff7f0e"
                        strokeWidth={2}
                        name="Buyer Volume (Demand)"
                        dot={{ r: 3, fill: '#ff7f0e' }}
                        activeDot={{ r: 5, fill: '#ff7f0e' }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}