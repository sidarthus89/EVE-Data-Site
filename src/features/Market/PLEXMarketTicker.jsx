// src/features/Market/PLEXMarketTicker.jsx

import React, { useEffect, useRef, useState } from "react";
import "./PLEXMarketTicker.css";
import { fetchMarketOrders } from '../../utils/market.js';

const formatISK = (value) =>
    `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK`;

import { applyOutlierFilter as applyFilter, FILTER_OPTIONS } from '../../utils/common.js';

// Use the same volume weighted average as MarketTables.jsx
const computeVolumeWeightedAverage = (orders) => {
    if (!orders || orders.length === 0) return null;
    const totalVolume = orders.reduce((sum, o) => sum + o.volume_remain, 0);
    const weightedSum = orders.reduce((sum, o) => sum + o.price * o.volume_remain, 0);
    return totalVolume > 0 ? weightedSum / totalVolume : null;
};

export async function getPLEXTickerStats(regionsData, applyOutliers = true) {
    try {
        const PLEX_TYPE_ID = 44992;
        const PLEX_REGION_ID = 19000001; // PLEX has its own dedicated region

        // Fetch PLEX orders from its dedicated region
        let allOrders = [];
        try {
            const result = await fetchMarketOrders(PLEX_TYPE_ID, PLEX_REGION_ID);
            allOrders = [...(result.sellOrders || []), ...(result.buyOrders || [])];
        } catch (err) {
            console.warn(`Failed to fetch PLEX orders from region ${PLEX_REGION_ID}:`, err);
            return { name: "PLEX", highestBuy: null, lowestSell: null, averageSell: null };
        }

        // Filter orders 
        const sellOrders = allOrders.filter(o => !o.is_buy_order);
        const buyOrders = allOrders.filter(o => o.is_buy_order);

        // Apply outlier filtering
        const filteredSellOrders = applyFilter(sellOrders, applyOutliers);
        const filteredBuyOrders = applyFilter(buyOrders, applyOutliers);

        // Calculate stats using the same methods as MarketTables.jsx
        const averageSell = computeVolumeWeightedAverage(filteredSellOrders);
        const highestBuy = filteredBuyOrders.length > 0 ? Math.max(...filteredBuyOrders.map(o => o.price)) : null;
        const lowestSell = filteredSellOrders.length > 0 ? Math.min(...filteredSellOrders.map(o => o.price)) : null;

        return { name: "PLEX", highestBuy, lowestSell, averageSell };
    } catch (err) {
        console.error("Failed to fetch PLEX stats:", err);
        throw err;
    }
}

export default function PLEXMarketTicker({ regionsData, filterOutliers }) {
    const containerRef = useRef(null);
    const [stats, setStats] = useState(null);

    useEffect(() => {
        if (!regionsData) return;

        getPLEXTickerStats(regionsData, filterOutliers)
            .then(data => {
                setStats(data);
            })
            .catch(err => console.error("❌ PLEX ticker fetch failed:", err));
    }, [regionsData, filterOutliers]);

    useEffect(() => {
        if (!stats || !containerRef.current) return;

        const container = containerRef.current;
        container.innerHTML = "";

        const item = document.createElement("div");
        item.className = "marquee__item";

        const segments = [
            { label: "Highest Buy", value: stats.highestBuy, className: "highest" },
            { label: "Lowest Sell", value: stats.lowestSell, className: "lowest" },
            { label: "Average Sell", value: stats.averageSell, className: "average" }
        ].filter(segment => segment.value !== null); // Only show segments with valid data

        segments.forEach(({ label, value, className }) => {
            const span = document.createElement("span");
            span.className = `marquee__text ${className}`;
            span.textContent = `PLEX — ${label}: ${formatISK(value)} • `;
            item.appendChild(span);
        });

        // Only proceed if we have segments to display
        if (segments.length === 0) {
            const span = document.createElement("span");
            span.className = "marquee__text";
            span.textContent = "PLEX — Loading market data... • ";
            item.appendChild(span);
        }

        container.appendChild(item);
        container.offsetWidth;

        const itemWidth = item.offsetWidth;
        const containerWidth = container.parentElement.offsetWidth;
        const copies = Math.ceil((containerWidth / itemWidth) * 2) + 2;

        for (let i = 1; i < copies; i++) {
            container.appendChild(item.cloneNode(true));
        }

        const animationName = `marquee-scroll-${Date.now()}`;
        const keyframes = `
            @keyframes ${animationName} {
                0% { transform: translateX(0); }
                100% { transform: translateX(-${itemWidth}px); }
            }
        `;

        const styleTag = document.createElement("style");
        styleTag.id = "marquee-keyframes";
        styleTag.textContent = keyframes;
        document.head.appendChild(styleTag);

        /* Control speed */
        container.style.animation = `${animationName} ${itemWidth / 60}s linear infinite`;

        return () => {
            document.querySelector("#marquee-keyframes")?.remove();
        };
    }, [stats]);

    return (
        <div id="plexTicker" className="marquee">
            <div ref={containerRef} className="marquee__content" />
        </div>
    );
}