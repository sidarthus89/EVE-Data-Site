// src/features/Market/MarketQuickbar.jsx

import { useEffect, useState } from 'react';

const QUICKBAR_KEY = "eveQuickbar";

export default function MarketQuickbar() {
    const [quickbarItems, setQuickbarItems] = useState([]);

    // 🔁 Load from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem(QUICKBAR_KEY);
        if (saved) {
            try {
                setQuickbarItems(JSON.parse(saved));
            } catch (err) {
                console.error('❌ Failed to parse quickbar items', err);
            }
        }
    }, []);

    // 💾 Persist on change
    useEffect(() => {
        localStorage.setItem(QUICKBAR_KEY, JSON.stringify(quickbarItems));
    }, [quickbarItems]);

    return (
        <div className="quickbar">
            {quickbarItems.length === 0 ? (
                <span>Quickbar items coming soon...</span>
            ) : (
                quickbarItems.map((item) => (
                    <div key={item.id} className="quickbar-item">
                        {item.name}
                    </div>
                ))
            )}
        </div>
    );
}
