// src/features/MarketSearch/MarketSidebar.jsx

import React, { useState, useEffect, useRef } from 'react';
import './MarketSidebar.css';
import RegionSelector from '../RegionSelector/RegionSelector';
import MarketSearch from './MarketSearch';
import MarketQuickbar from './MarketQuickbar';
import MarketTree from './MarketTree';

export default function MarketSidebar({
    selectedRegion,
    onRegionChange,
    onItemSelect,
    marketTree,
    breadcrumbPath, // Add this prop
}) {
    const [locations, setLocations] = useState({});
    const [activeTab, setActiveTab] = useState('market');
    const [expandedNodes, setExpandedNodes] = useState(new Set());
    const tabContainerRef = useRef(null);
    const marketTabRef = useRef(null);
    const quickbarTabRef = useRef(null);

    const popularRegions = [
        'The Forge',
        'Domain',
        'Tenerifis',
        'Sinq Laison',
        'Essence',
    ];

    useEffect(() => {
        fetch('./data/locations.json')
            .then((res) => res.json())
            .then((data) => {
                setLocations(data);
                onRegionChange?.('all');
            });
    }, [onRegionChange]);

    // Set initial underline position after component mounts
    useEffect(() => {
        const updateUnderlinePosition = () => {
            const containerEl = tabContainerRef.current;
            const activeTabEl = activeTab === 'market' ? marketTabRef.current : quickbarTabRef.current;
            const marketTabEl = marketTabRef.current;
            const quickbarTabEl = quickbarTabRef.current;

            if (containerEl && activeTabEl && marketTabEl && quickbarTabEl) {
                // Set active underline position
                containerEl.style.setProperty('--underline-x', `${activeTabEl.offsetLeft}px`);
                containerEl.style.setProperty('--underline-width', `${activeTabEl.offsetWidth}px`);

                // Set grey base line to span from start of first tab to end of last tab
                const baselineStart = marketTabEl.offsetLeft;
                const baselineEnd = quickbarTabEl.offsetLeft + quickbarTabEl.offsetWidth;
                const baselineWidth = baselineEnd - baselineStart;

                containerEl.style.setProperty('--baseline-x', `${baselineStart}px`);
                containerEl.style.setProperty('--baseline-width', `${baselineWidth}px`);
            }
        };

        // Small delay to ensure DOM is fully rendered
        const timeout = setTimeout(updateUnderlinePosition, 10);

        // Also update on window resize
        window.addEventListener('resize', updateUnderlinePosition);

        return () => {
            clearTimeout(timeout);
            window.removeEventListener('resize', updateUnderlinePosition);
        };
    }, [activeTab]);

    const collapseAll = () => {
        setExpandedNodes(new Set());
    };

    const renderRegionOptions = () => {
        const allRegionKeys = Object.keys(locations);
        const popularRegionOptions = popularRegions.filter((r) =>
            allRegionKeys.includes(r)
        );
        const otherRegionOptions = allRegionKeys.filter(
            (r) => !popularRegionOptions.includes(r)
        );

        return (
            <>
                <option key="all" value="all">All Regions</option>
                {popularRegionOptions.length > 0 && (
                    <optgroup label="Popular Regions">
                        {popularRegionOptions.map((regionKey) => (
                            <option key={regionKey} value={regionKey}>
                                {regionKey}
                            </option>
                        ))}
                    </optgroup>
                )}
                {otherRegionOptions.length > 0 && (
                    <optgroup label="All Other Regions">
                        {otherRegionOptions.map((regionKey) => (
                            <option key={regionKey} value={regionKey}>
                                {regionKey}
                            </option>
                        ))}
                    </optgroup>
                )}
            </>
        );
    };

    const handleTabClick = (tabName) => {
        const containerEl = tabContainerRef.current;
        const targetTabEl = tabName === 'market' ? marketTabRef.current : quickbarTabRef.current;
        const marketTabEl = marketTabRef.current;
        const quickbarTabEl = quickbarTabRef.current;

        if (containerEl && targetTabEl && marketTabEl && quickbarTabEl) {
            // Update active underline position
            containerEl.style.setProperty('--underline-x', `${targetTabEl.offsetLeft}px`);
            containerEl.style.setProperty('--underline-width', `${targetTabEl.offsetWidth}px`);

            // Update grey base line to span from start of first tab to end of last tab
            const baselineStart = marketTabEl.offsetLeft;
            const baselineEnd = quickbarTabEl.offsetLeft + quickbarTabEl.offsetWidth;
            const baselineWidth = baselineEnd - baselineStart;

            containerEl.style.setProperty('--baseline-x', `${baselineStart}px`);
            containerEl.style.setProperty('--baseline-width', `${baselineWidth}px`);
        }

        setActiveTab(tabName);
    };

    return (
        <aside id="sidebar" className="sidebar">
            {/* Header */}
            <div className="sidebar-header">
                <div className="regionSelector-wrapper">
                    <select
                        className="region-selector"
                        value={selectedRegion}
                        onChange={(e) => onRegionChange(e.target.value)}
                    >
                        {renderRegionOptions()}
                    </select>
                </div>

                <div className="search-wrapper">
                    <MarketSearch
                        marketTree={marketTree}
                        expandedNodes={expandedNodes}
                        setExpandedNodes={setExpandedNodes}
                        onItemSelect={onItemSelect}
                    />
                    <button
                        className="collapse-button"
                        title="Collapse all groups"
                        onClick={collapseAll}
                    >
                        <img src="/assets/collapse.png" alt="Collapse" />
                    </button>
                </div>

                <div className="tab-container" ref={tabContainerRef}>
                    <div className="sidebar-tabs">
                        <button
                            ref={marketTabRef}
                            className={`sidebar-tab-link ${activeTab === 'market' ? 'active' : ''}`}
                            onClick={() => handleTabClick('market')}
                        >
                            Market
                        </button>
                        <button
                            ref={quickbarTabRef}
                            className={`sidebar-tab-link ${activeTab === 'quickbar' ? 'active' : ''}`}
                            onClick={() => handleTabClick('quickbar')}
                        >
                            Quickbar
                        </button>
                    </div>
                </div>

            </div>

            {/* Scrollable content */}
            <div className="sidebar-scrollable">
                {activeTab === 'market' && marketTree && (
                    <MarketTree
                        marketTree={marketTree}
                        onItemSelect={onItemSelect}
                        breadcrumbPath={breadcrumbPath}
                    />
                )}
                {activeTab === 'quickbar' && <MarketQuickbar />}
            </div>
        </aside>
    );
}