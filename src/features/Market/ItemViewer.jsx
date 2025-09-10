// src/features/ItemViewer.jsx

import { useEffect, useState } from 'react';
import { FiLink, FiCheck } from 'react-icons/fi';
import './ItemViewer.css';

export default function ItemViewer({ selectedItem, marketTree, onBreadcrumbClick }) {
    const [breadcrumb, setBreadcrumb] = useState([]);
    const [isCopied, setIsCopied] = useState(false);

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
            // Fire global event so MarketQuickbar reacts immediately when its tab is active
            window.dispatchEvent(new CustomEvent('quickbar:add', { detail: selectedItem }));
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
                        style={{ minWidth: '140px', padding: '8px 14px', textAlign: 'center' }}
                    >
                        Add to Quickbar
                    </button>

                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={async () => {
                                const baseUrl = `${window.location.origin}${import.meta.env.BASE_URL || ''}market`;
                                const link = `${baseUrl}?item=${selectedItem.typeID}`;
                                try {
                                    await navigator.clipboard.writeText(link);
                                    setIsCopied(true);
                                    setTimeout(() => setIsCopied(false), 2000);
                                } catch (err) {
                                    console.error('Failed to copy link:', err);
                                }
                            }}
                            className="item-link"
                            title="Copy market link (opens item on load)"
                        >
                            {isCopied ? <FiCheck className="icon" /> : <FiLink className="icon" />}
                        </button>
                        {isCopied && (
                            <div className="copy-tooltip" style={{ top: '-30px', left: '0' }}>
                                Link copied!
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}



function findItemBreadcrumb(typeID, tree) {
    const target = Number(typeID);
    let result = [];

    function containsTypeId(arr) {
        return Array.isArray(arr) &&
            arr.some(x => x && typeof x === 'object' && Number(x.typeID) === target);
    }

    function getCategoryDisplayName(fallbackKey) {
        // The human-readable names are the object keys themselves in market.json
        // No need to look in _info as it only contains metadata
        return fallbackKey;
    }

    function walk(node, trail = [], parentKey) {
        if (!node || typeof node !== 'object') return false;

        // Add parent key as category name for first level
        if (trail.length === 0 && parentKey) {
            const displayName = getCategoryDisplayName(parentKey);
            trail = [{ key: parentKey, name: displayName }];
        }

        // 1) Leaf: this node has an items array containing the target
        if (containsTypeId(node.items)) {
            result = trail.map(t => t.name);
            return true;
        }

        // 2) Defensive: any array prop that directly holds items with typeID
        for (const [k, v] of Object.entries(node)) {
            if (k === '_info' || k === 'items') continue;
            if (Array.isArray(v) && containsTypeId(v)) {
                result = trail.map(t => t.name);
                return true;
            }
        }

        // 3) Recurse into child categories (objects only)
        for (const [key, value] of Object.entries(node)) {
            if (key === '_info' || key === 'items') continue;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const displayName = getCategoryDisplayName(key);
                if (walk(value, [...trail, { key, name: displayName }], key)) return true;
            }
        }
        return false;
    }

    // Handle both array format (from MarketTree component) and object format (raw market.json)
    if (Array.isArray(tree)) {
        // Array format: [{ name: "Category Name", ... }, ...]
        for (const topNode of tree) {
            if (topNode && typeof topNode === 'object') {
                const topKey = topNode.name || 'Unknown';
                if (walk(topNode, [], topKey)) return result;
            }
        }
    } else {
        // Object format: { "Category Name": { ... }, ... }
        for (const [topKey, topValue] of Object.entries(tree)) {
            if (topValue && typeof topValue === 'object' && !Array.isArray(topValue)) {
                if (walk(topValue, [], topKey)) return result;
            }
        }
    }

    return ['Unknown Category'];
}