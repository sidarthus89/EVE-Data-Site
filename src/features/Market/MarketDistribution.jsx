// src/features/Market/MarketDistribution.jsx
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
    orders,
    regions,
    onRegionClick,
    selectedRegion
}) {
    // Debug: Log the selectedRegion value
    console.log('MarketDistribution selectedRegion:', selectedRegion);

    if (selectedRegion !== 'all' && selectedRegion !== 'All Regions' && selectedRegion?.regionID !== 'all') {
        return null;
    }

    const filteredOrders = useMemo(() => {
        if (!orders || orders.length === 0) return [];

        const prices = orders.map(order => order.price).filter(price => price > 0);
        if (prices.length === 0) return [];

        prices.sort((a, b) => a - b);

        // Calculate 1st percentile (bottom 1%) and 99th percentile (top 1%)
        const p1Index = Math.floor(prices.length * 0.01);
        const p99Index = Math.floor(prices.length * 0.99);

        // Ensure we don't go out of bounds
        const lowerBoundIndex = Math.max(0, p1Index);
        const upperBoundIndex = Math.min(prices.length - 1, p99Index);

        const lowerBound = prices[lowerBoundIndex];
        const upperBound = prices[upperBoundIndex];

        return orders.filter(order => {
            const price = order.price;
            return price >= lowerBound &&
                price <= upperBound &&
                order.volume_remain > 0;
        });
    }, [orders]);

    const data = useMemo(() => {
        if (!regions || regions.length === 0) return [];

        const map = {};
        regions.forEach(({ regionName }) => {
            map[regionName] = { region: regionName, buyerVolume: 0, sellerVolume: 0 };
        });

        filteredOrders.forEach(order => {
            const region = order.regionName;
            if (!map[region]) return;

            if (order.is_buy_order) {
                map[region].buyerVolume += order.volume_remain;
            } else {
                map[region].sellerVolume += order.volume_remain;
            }
        });

        return Object.values(map);
    }, [filteredOrders, regions]);

    useEffect(() => {
        console.log('📊 MarketDistribution data:', data);
        console.log('📊 Orders count:', orders?.length || 0);
        console.log('📊 Filtered orders count:', filteredOrders.length);
        console.log('📊 Regions count:', regions?.length || 0);
    }, [data, orders, filteredOrders, regions]);

    const legendPayload = [
        { value: 'Seller Volume (Supply)', type: 'rect', color: '#2ca02c', id: 'sellerVolume' },
        { value: 'Buyer Volume (Demand)', type: 'line', color: '#ff7f0e', id: 'buyerVolume' }
    ];

    const handleBarClick = (data) => {
        if (onRegionClick) {
            onRegionClick(data.region);
        }
    };

    // Show loading state if no data
    if (!data || data.length === 0) {
        return (
            <div style={{ width: '100%', height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p>No market data available for distribution chart</p>
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height={400}>
                <ComposedChart
                    data={data}
                    margin={{ top: 20, right: 50, left: 50, bottom: 40 }}
                    onClick={(e) => {
                        if (e && e.activeLabel && onRegionClick) {
                            onRegionClick(e.activeLabel);
                        }
                    }}
                >
                    <XAxis
                        dataKey="region"
                        angle={-30}
                        textAnchor="end"
                        interval={0}
                        height={80}
                    />
                    <YAxis
                        yAxisId="left"
                        orientation="left"
                        stroke="#2ca02c"
                        label={{ value: 'Seller Volume (Supply)', angle: -90, position: 'insideLeft' }}
                    />
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        stroke="#ff7f0e"
                        label={{ value: 'Buyer Volume (Demand)', angle: 90, position: 'insideRight' }}
                    />
                    <Tooltip />
                    <Legend payload={legendPayload} verticalAlign="top" />

                    {/* Seller volume as green bars */}
                    <Bar
                        yAxisId="left"
                        dataKey="sellerVolume"
                        fill="#2ca02c"
                        name="Seller Volume (Supply)"
                        barSize={20}
                        onClick={handleBarClick}
                    />

                    {/* Buyer volume as orange line */}
                    <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="buyerVolume"
                        stroke="#ff7f0e"
                        strokeWidth={2}
                        name="Buyer Volume (Demand)"
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}