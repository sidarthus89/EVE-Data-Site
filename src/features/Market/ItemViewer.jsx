// src/features/MarketSearch/ItemViewer.jsx

import { useEffect, useState } from 'react';
import { FiPlus, FiLink } from 'react-icons/fi';
import './ItemViewer.css';

export default function ItemViewer({ selectedItem, marketTree, onBreadcrumbClick }) {
    const [breadcrumb, setBreadcrumb] = useState([]);

    useEffect(() => {
        if (selectedItem?.typeID && marketTree) {
            const trail = findItemBreadcrumb(selectedItem.typeID, marketTree);
            setBreadcrumb(trail);
        }
    }, [selectedItem, marketTree]);

    const iconURL = `https://images.evetech.net/types/${selectedItem?.typeID}/icon?size=64`;

    const handleAddToQuickbar = () => {
        const QUICKBAR_KEY = "eveQuickbar";
        const existing = JSON.parse(localStorage.getItem(QUICKBAR_KEY) || "[]");
        const alreadyExists = existing.some((item) => item.typeID === selectedItem.typeID);
        if (!alreadyExists) {
            localStorage.setItem(QUICKBAR_KEY, JSON.stringify([...existing, selectedItem]));
        }
    };

    if (!selectedItem) return null;

    return (
        <div className="item-viewer">
            <img
                src={iconURL}
                alt={selectedItem.typeName}
                className="item-icon"
                onError={(e) => (e.target.src = '/assets/fallback_icon.png')}
            />

            <div className="item-details">
                <div className="breadcrumb">
                    {breadcrumb.map((segment, index) => (
                        <span key={index}>
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    onBreadcrumbClick(breadcrumb.slice(0, index + 1));
                                }}
                            >
                                {segment}
                            </a>
                            {index < breadcrumb.length - 1 && <span> / </span>}
                        </span>
                    ))}
                </div>

                <div className="item-header-row">
                    <div className="item-name">{selectedItem.typeName}</div>

                    <button
                        className="quickbar-btn"
                        onClick={handleAddToQuickbar}
                        title="Add to Quickbar"
                    >
                        <FiPlus className="icon" />
                    </button>

                    <button
                        onClick={() => {
                            const url = `${window.location.origin}/market?item=${selectedItem.typeID}`;
                            navigator.clipboard.writeText(url);
                        }}
                        className="item-link"
                        title="Copy item link"
                    >
                        <FiLink className="icon" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function findItemBreadcrumb(typeID, tree) {
    let path = [];
    let found = false;

    function walk(node, trail = []) {
        for (const [key, value] of Object.entries(node)) {
            if (key === '_info') continue;
            if (Array.isArray(value)) {
                if (value.some(item => Number(item.typeID) === Number(typeID))) {
                    path = [...trail, key === 'items' ? null : key].filter(Boolean);
                    found = true;
                    return true;
                }
            } else if (typeof value === 'object' && value !== null) {
                if (walk(value, [...trail, key])) return true;
            }
        }
        return false;
    }

    walk(tree);
    return found ? path : ['Unknown Category'];
}