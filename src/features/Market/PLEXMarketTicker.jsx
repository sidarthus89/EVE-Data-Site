// src/features/Market/PLEXMarketTicker.jsx

import React, { useEffect, useRef, useState } from "react";
import { fetchMarketOrders } from "../../api/esiAPI.js";
import "./PLEXMarketTicker.css";

function getAverage(orders) {
    return orders.length
        ? orders.reduce((sum, o) => sum + o.price, 0) / orders.length
        : 0;
}

const formatISK = (value) =>
    `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK`;


async function getPLEXTickerStats() {
    const PLEX_REGION_ID = 19000001;
    const PLEX_TYPE_ID = 44992;

    try {
        const { buyOrders, sellOrders } = await fetchMarketOrders(PLEX_TYPE_ID, PLEX_REGION_ID);
        const highestBuy = buyOrders.length ? Math.max(...buyOrders.map(o => o.price)) : 0;
        const lowestSell = sellOrders.length ? Math.min(...sellOrders.map(o => o.price)) : 0;
        const averageSell = getAverage(sellOrders);

        return { name: "PLEX", highestBuy, lowestSell, averageSell };
    } catch (err) {
        console.warn("📉 Failed to fetch PLEX stats:", err);
        return { name: "PLEX", highestBuy: 0, lowestSell: 0, averageSell: 0 };
    }
}

export default function PLEXMarketTicker() {
    const containerRef = useRef(null);
    const [stats, setStats] = useState(null);

    useEffect(() => {
        getPLEXTickerStats().then(setStats);
    }, []);

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
        ];

        segments.forEach(({ label, value, className }) => {
            const span = document.createElement("span");
            span.className = `marquee__text ${className}`;
            span.textContent = `PLEX — ${label}: ${formatISK(value)} • `;
            item.appendChild(span);
        });

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
