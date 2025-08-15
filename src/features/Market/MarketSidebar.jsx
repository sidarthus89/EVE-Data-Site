// src/features/MarketSearch/MarketSidebar.jsx

import React, { useRef } from 'react';
import './MarketSidebar.css';
import RegionSelector from '../RegionSelector/RegionSelector';
import MarketSearch from './MarketSearch';
import MarketQuickbar from './MarketQuickbar';
import MarketTree from './MarketTree';

export default function MarketSidebar({
    selectedRegion,
    onRegionChange,
    regions,
    onItemSelect,
    marketTree,
    breadcrumbPath,
}) {
    const [activeTab, setActiveTab] = React.useState('market');
    const [expandedNodes, setExpandedNodes] = React.useState(new Set());

    const tabContainerRef = useRef(null);
    const marketTabRef = useRef(null);
    const quickbarTabRef = useRef(null);

    React.useEffect(() => {
        const updateUnderlinePosition = () => {
            const containerEl = tabContainerRef.current;
            const activeTabEl = activeTab === 'market' ? marketTabRef.current : quickbarTabRef.current;
            const marketTabEl = marketTabRef.current;
            const quickbarTabEl = quickbarTabRef.current;

            if (containerEl && activeTabEl && marketTabEl && quickbarTabEl) {
                containerEl.style.setProperty('--underline-x', `${activeTabEl.offsetLeft}px`);
                containerEl.style.setProperty('--underline-width', `${activeTabEl.offsetWidth}px`);

                const baselineStart = marketTabEl.offsetLeft;
                const baselineEnd = quickbarTabEl.offsetLeft + quickbarTabEl.offsetWidth;
                const baselineWidth = baselineEnd - baselineStart;

                containerEl.style.setProperty('--baseline-x', `${baselineStart}px`);
                containerEl.style.setProperty('--baseline-width', `${baselineWidth}px`);
            }
        };

        const timeout = setTimeout(updateUnderlinePosition, 10);
        window.addEventListener('resize', updateUnderlinePosition);

        return () => {
            clearTimeout(timeout);
            window.removeEventListener('resize', updateUnderlinePosition);
        };
    }, [activeTab]);

    const collapseAll = () => {
        setExpandedNodes(new Set());
    };

    const handleTabClick = (tabName) => {
        setActiveTab(tabName);
    };

    return (
        <aside id="sidebar" className="sidebar">
            {/* Header */}
            <div className="sidebar-header">
                <div className="regionSelector-wrapper">
                    <RegionSelector
                        selectedRegion={selectedRegion}
                        onRegionChange={onRegionChange}
                        regions={regions}
                    />
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