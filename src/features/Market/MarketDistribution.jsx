// src/features/Market/MarketDistribution.jsx
import React, { useMemo } from 'react';
import {
    BarChart,
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
    if (selectedRegion !== 'all' && selectedRegion !== 'All Regions') {
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
        const map = {};
        regions.forEach(region => {
            map[region] = { region, buyerVolume: 0, sellerVolume: 0 };
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

    const legendPayload = [
        { value: 'Seller Volume (Supply)', type: 'square', color: '#2ca02c', id: 'sellerVolume' },
        { value: 'Buyer Volume (Demand)', type: 'line', color: '#ff7f0e', id: 'buyerVolume' }
    ];

    const handleBarClick = (data) => {
        if (onRegionClick) {
            onRegionClick(data.region);
        }
    };

    return (
        <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height={400}>
                <BarChart
                    data={data}
                    margin={{ top: 20, right: 50, left: 50, bottom: 40 }}
                >
                    <XAxis
                        dataKey="region"
                        angle={-30}
                        textAnchor="end"
                        interval={0}
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
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}