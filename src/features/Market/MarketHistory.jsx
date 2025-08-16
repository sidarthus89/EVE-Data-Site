import React, { useEffect, useState } from 'react';
import {
    ComposedChart,
    Line,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    ResponsiveContainer,
    CartesianGrid,
} from 'recharts';
import { fetchAggregatedMarketHistory } from '../../api/esiAPI';

export default function MarketHistory({ selectedItem, regions }) {
    const [historyData, setHistoryData] = useState([]);

    useEffect(() => {
        if (!selectedItem || !regions || regions.length === 0) {
            setHistoryData([]);
            return;
        }

        let cancelled = false;

        async function loadAggregateHistory() {
            try {
                const { data, failedRegions } = await fetchAggregatedMarketHistory(selectedItem.typeID, regions);
                if (!cancelled) {
                    setHistoryData(data);
                    if (failedRegions.length > 0) {
                        console.warn(`⚠️ Market history unavailable for regions: ${failedRegions.join(', ')}`);
                    }
                }
            } catch (error) {
                console.error('Failed to load aggregated market history', error);
                if (!cancelled) setHistoryData([]);
            }
        }

        loadAggregateHistory();

        return () => {
            cancelled = true;
        };
    }, [selectedItem, regions]);

    if (!historyData.length) {
        return <p>No market history data available.</p>;
    }


    return (
        <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                    data={historyData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 50 }}
                >
                    <CartesianGrid strokeDasharray="3 3" />

                    <XAxis
                        dataKey="date"
                        angle={-45}
                        textAnchor="end"
                        interval={Math.floor(historyData.length / 10)}
                    />

                    {/* Left Y axis for average price */}
                    <YAxis
                        yAxisId="left"
                        label={{ value: 'Avg Price (ISK)', angle: -90, position: 'insideLeft' }}
                        tickFormatter={(value) => value ? value.toLocaleString() : ''}
                        domain={['auto', 'auto']}
                    />

                    {/* Right Y axis for total volume */}
                    <YAxis
                        yAxisId="right"
                        orientation="right"
                        label={{ value: 'Volume', angle: 90, position: 'insideRight' }}
                        tickFormatter={(value) => value ? value.toLocaleString() : ''}
                        domain={[0, 'auto']}
                    />

                    <Tooltip
                        formatter={(value, name) => {
                            if (name === 'totalVolume') return [value.toLocaleString(), 'Volume'];
                            return [value ? value.toLocaleString() : 'N/A', 'Avg Price (ISK)'];
                        }}
                    />

                    <Legend verticalAlign="top" />

                    {/* Single Line for aggregate average price */}
                    <Line
                        yAxisId="left"
                        type="monotone"
                        dataKey="average"
                        stroke="#1f77b4"
                        dot={false}
                    />

                    {/* Bar for aggregate total volume */}
                    <Bar
                        yAxisId="right"
                        dataKey="totalVolume"
                        fill="#8884d8"
                        barSize={20}
                        opacity={0.4}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
