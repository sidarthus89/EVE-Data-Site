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

    const [treeCollapsed, setTreeCollapsed] = useState(false);
    const collapseAll = () => {
        setExpandedNodes(new Set());
        setTreeCollapsed(true);
    };
    const toggleCollapseVisibility = () => setTreeCollapsed(prev => !prev);
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
                        title={treeCollapsed ? 'Expand tree' : 'Collapse all groups'}
                        onClick={() => {
                            if (treeCollapsed) {
                                setTreeCollapsed(false);
                            } else {
                                collapseAll();
                            }
                        }}
                    >
                        <img src={`${import.meta.env.BASE_URL}assets/collapse.png`} alt="Collapse" style={{ transform: treeCollapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
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
                {activeTab === 'market' && marketTree && !treeCollapsed && (
                    <MarketTree
                        marketTree={marketTree}
                        onItemSelect={onItemSelect}
                        breadcrumbPath={breadcrumbPath}
                    />
                )}
                {activeTab === 'quickbar' && <MarketQuickbar onItemSelect={onItemSelect} />}
            </div>
        </aside>
    );
}
