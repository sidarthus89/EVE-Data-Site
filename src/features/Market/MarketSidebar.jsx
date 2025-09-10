// src/features/MarketSearch/MarketSidebar.jsx
import React, { useRef, useState, useEffect } from 'react';
import './MarketSidebar.css';
import RegionSelector from '../../components/RegionSelector/RegionSelector';
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
    const [activeTab, setActiveTab] = useState('market');
    const [expandedNodes, setExpandedNodes] = useState(new Set());

    const tabContainerRef = useRef(null);
    const marketTabRef = useRef(null);
    const quickbarTabRef = useRef(null);

    // Animate underline
    useEffect(() => {
        const updateUnderlinePosition = () => {
            const containerEl = tabContainerRef.current;
            const activeTabEl = activeTab === 'market' ? marketTabRef.current : quickbarTabRef.current;
            if (!containerEl || !activeTabEl) return;

            containerEl.style.setProperty('--underline-x', `${activeTabEl.offsetLeft}px`);
            containerEl.style.setProperty('--underline-width', `${activeTabEl.offsetWidth}px`);
        };

        const timeout = setTimeout(updateUnderlinePosition, 10);
        window.addEventListener('resize', updateUnderlinePosition);

        return () => {
            clearTimeout(timeout);
            window.removeEventListener('resize', updateUnderlinePosition);
        };
    }, [activeTab]);

    // Collapse version counter to signal MarketTree to collapse all expanded groups
    const [collapseVersion, setCollapseVersion] = useState(0);
    const collapseAll = () => {
        setExpandedNodes(new Set());
        setCollapseVersion(v => v + 1); // signal child tree to reset its internal expansion state
    };
    const handleTabClick = (tabName) => setActiveTab(tabName);

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
                        title={'Collapse all groups'}
                        onClick={collapseAll}
                    >
                        <img src={`${import.meta.env.BASE_URL}assets/collapse.png`} alt="Collapse" />
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
                        collapseVersion={collapseVersion}
                    />
                )}
                {activeTab === 'quickbar' && <MarketQuickbar onItemSelect={onItemSelect} />}
            </div>
        </aside>
    );
}
