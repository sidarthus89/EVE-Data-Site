// src/features/Market/MarketQuickbar.jsx

import { useEffect, useState } from 'react';

const QUICKBAR_KEY = "eveQuickbar";

export default function MarketQuickbar({ onItemSelect }) {
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

    // Listen for quickbar:add events
    useEffect(() => {
        const handleQuickbarAdd = (event) => {
            const item = event.detail;
            setQuickbarItems(prev => {
                // Check if item already exists
                if (prev.some(i => i.typeID === item.typeID)) {
                    return prev;
                }
                const newItems = [...prev, item];
                localStorage.setItem(QUICKBAR_KEY, JSON.stringify(newItems));
                return newItems;
            });
        };

        window.addEventListener('quickbar:add', handleQuickbarAdd);
        return () => window.removeEventListener('quickbar:add', handleQuickbarAdd);
    }, []);

    const removeFromQuickbar = (typeID) => {
        setQuickbarItems(prev => {
            const newItems = prev.filter(item => item.typeID !== typeID);
            localStorage.setItem(QUICKBAR_KEY, JSON.stringify(newItems));
            return newItems;
        });
    };

    if (quickbarItems.length === 0) {
        return (
            <div className="quickbar-empty">
                <p>No items in quickbar</p>
                <p className="quickbar-hint">Hover over items in the market tree and click the + button to add them here</p>
            </div>
        );
    }

    return (
        <div className="quickbar">
            {quickbarItems.map((item) => (
                <div key={item.typeID} className="quickbar-item">
                    <div
                        className="quickbar-item-name"
                        onClick={() => onItemSelect?.(item)}
                    >
                        <img
                            src={`https://images.evetech.net/types/${item.typeID}/icon?size=32`}
                            alt=""
                            className="quickbar-item-icon"
                        />
                        <span>{item.typeName}</span>
                    </div>
                    <button
                        className="quickbar-remove-btn"
                        onClick={() => removeFromQuickbar(item.typeID)}
                        title="Remove from quickbar"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
