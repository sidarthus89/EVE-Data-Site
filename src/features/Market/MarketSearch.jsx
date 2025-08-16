// src/features/Market/MarketSearch.jsx

import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './MarketSearch.css';

function getMatchingItems(term, tree) {
    const results = [];
    const visited = new Set();

    function recurse(node) {
        if (node === null || typeof node !== 'object') return;
        if (visited.has(node)) return;
        visited.add(node);

        if (Array.isArray(node.items)) {
            const matchedItems = node.items.filter((item) =>
                item.typeName?.toLowerCase().includes(term.toLowerCase())
            );
            results.push(...matchedItems);
        }

        for (const [key, value] of Object.entries(node)) {
            if (['_info', 'items'].includes(key)) continue;
            recurse(value);
        }
    }

    if (Array.isArray(tree)) {
        tree.forEach(recurse);
    } else {
        recurse(tree);
    }

    return results;
}

export default function MarketSearch({
    marketTree,
    expandedNodes,
    setExpandedNodes,
    onItemSelect,
}) {
    const [term, setTerm] = useState('');
    const [suggestions, setSuggestions] = useState([]);

    useEffect(() => {
        if (term.length >= 4) {
            const matches = getMatchingItems(term, marketTree);
            const sorted = matches.sort((a, b) =>
                a.typeName.localeCompare(b.typeName)
            );

            setSuggestions(sorted);
        } else {
            setSuggestions([]);
        }
    }, [term, marketTree]);

    const containerRef = useRef();
    useEffect(() => {
        function handleOutsideClick(e) {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setSuggestions([]);
            }
        }

        function handleEscapePress(e) {
            if (e.key === 'Escape') {
                setSuggestions([]);
            }
        }

        document.addEventListener('mousedown', handleOutsideClick);
        document.addEventListener('keydown', handleEscapePress);

        return () => {
            document.removeEventListener('mousedown', handleOutsideClick);
            document.removeEventListener('keydown', handleEscapePress);
        };
    }, []);


    const handleChange = (e) => {
        const value = e.target.value;
        setTerm(value);
    };

    const clearSearch = () => {
        setTerm('');
        setSuggestions([]);
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            const match = suggestions.find((s) => s.typeName === term);
            if (match) {
                handleSuggestionClick(match);
            } else {
            }
        }
    };

    const handleSuggestionClick = (item) => {

        const path = findPathToItem(item.typeID, marketTree);

        if (path) {
            const updated = new Set(expandedNodes);
            path.reduce((acc, key) => {
                const joined = [...acc, key].join('/');
                updated.add(joined);
                return [...acc, key];
            }, []);
            setExpandedNodes(updated);
        } else {
            console.warn('⚠️ No path found for item (still selecting it):', item);
        }

        onItemSelect(item);
        setSuggestions([]);
        setTerm(item.typeName);
    };


    return (
        <div className="search-bar" ref={containerRef}>

            <input
                type="text"
                placeholder="Search"
                value={term}
                onChange={handleChange}
                onKeyDown={handleKeyPress}
            />
            <span className="search-clear" title="Clear Search" onClick={clearSearch}>
                &#x2573;
            </span>

            {term.length >= 4 && suggestions.length > 0 && (
                <ul className="search-suggestions">
                    {suggestions.map((item) => (
                        <li
                            key={item.typeID}
                            onClick={() => handleSuggestionClick(item)}
                            className="suggestion-item"
                        >
                            {item.typeName}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function findPathToItem(typeID, tree, path = [], visited = new Set()) {
    if (tree === null || typeof tree !== 'object') return null;
    if (visited.has(tree)) return null;
    visited.add(tree);

    for (const [key, node] of Object.entries(tree)) {
        if (typeof node !== 'object' || node === null) continue;

        const newPath = [...path, key];

        // Check for matching item in this node
        if (Array.isArray(node.items)) {
            const found = node.items.find(item => String(item.typeID) === String(typeID));
            if (found) return newPath;
        }

        // Recurse into child groups, skip metadata
        for (const [subKey, subValue] of Object.entries(node)) {
            if (['_info', 'items'].includes(subKey)) continue;
            if (typeof subValue !== 'object' || subValue === null) continue;

            const subPath = findPathToItem(typeID, subValue, [...newPath, subKey], visited);
            if (subPath) return subPath;
        }
    }

    return null;
}
