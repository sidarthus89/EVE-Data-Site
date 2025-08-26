// src/components/RegionSelector/RegionSelector.jsx

import { useEffect, useState, useMemo } from 'react';
import './RegionSelector.css';
import { loadRegions } from '../../utils/locationsClient';

const popularRegions = [
    'The Forge',
    'Domain',
    'Heimatar',
    'Sinq Laison',
    'Metropolis',
];

export default function RegionSelector({ selectedRegion, onRegionChange, allowAllRegions = true }) {
    const [regions, setRegions] = useState([]);
    const [error, setError] = useState(null);
    const [isLoadingFast, setIsLoadingFast] = useState(true);

    useEffect(() => {
        async function loadRegions() {
            try {
                console.log('RegionSelector: Loading regions from static data...');

                // 🚀 ONLY USE STATIC REGIONS.JSON - No fallback to market data
                const response = await fetch('./data/regions.json');
                if (!response.ok) {
                    throw new Error(`Failed to fetch regions.json: ${response.status}`);
                }

                const staticData = await response.json();
                if (!staticData || !staticData.regions || !Array.isArray(staticData.regions)) {
                    throw new Error('Invalid regions.json format');
                }

                console.log('✅ RegionSelector: Loaded', staticData.regions.length, 'regions from static data');

                // 🚫 FILTER OUT PLEX REGION from user selection (but keep it available programmatically)
                const PLEX_REGION_ID = 19000001;
                const userSelectableRegions = staticData.regions.filter(region => region.regionID !== PLEX_REGION_ID);

                console.log('📊 RegionSelector: Filtered to', userSelectableRegions.length, 'user-selectable regions (PLEX region hidden)');
                setRegions(userSelectableRegions);
                setError(null);
                setIsLoadingFast(false);

            } catch (err) {
                console.error('❌ RegionSelector: Failed to load regions.json:', err);
                setError(`Failed to load regions: ${err.message}`);
                setRegions([]);
                setIsLoadingFast(false);
            }
        }

        loadRegions();
    }, []); // ← only run once on mount

    useEffect(() => {
        // Auto-select "All Regions" only if allowAllRegions is true and no region is selected
        if (allowAllRegions && (!selectedRegion || !selectedRegion.regionID) && regions.length > 0) {
            console.log('[RegionSelector] No selectedRegion, defaulting to All Regions');
            onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
        }
    }, [selectedRegion, regions, onRegionChange, allowAllRegions]);

    // Group regions into popular and others, both sorted alphabetically
    const { popularRegionsList, otherRegionsList, allRegionsList } = useMemo(() => {
        const popular = regions.filter(r => popularRegions.includes(r.regionName))
            .sort((a, b) => a.regionName.localeCompare(b.regionName));
        const others = regions.filter(r => !popularRegions.includes(r.regionName))
            .sort((a, b) => a.regionName.localeCompare(b.regionName));
        const all = regions.slice().sort((a, b) => a.regionName.localeCompare(b.regionName));
        return {
            popularRegionsList: popular,
            otherRegionsList: others,
            allRegionsList: all
        };
    }, [regions]);

    // Render fallback UI if error or empty
    if (error) {
        console.error('❌ RegionSelector error:', error);
        return <div style={{ color: 'red', padding: '1rem' }}>Error loading regions: {error}</div>;
    }
    if (regions.length === 0) {
        const loadingText = isLoadingFast ? 'Loading regions...' : 'Discovering regions from market data...';
        console.log('⏳ RegionSelector loading:', loadingText);
        return <div style={{ padding: '1rem' }}>{loadingText}</div>;
    }

    // Debug output for troubleshooting
    console.log('[RegionSelector] Render', { selectedRegion, regions });

    // Render dropdown UI with grouped options
    return (
        <div className="region-selector-container">
            <select
                className="region-selector"
                id="region-select"
                value={selectedRegion?.regionID || (allowAllRegions ? 'all' : '')}
                onChange={e => {
                    const regionID = e.target.value;
                    if (!regionID) {
                        onRegionChange?.(null);
                        return;
                    }
                    if (regionID === 'all') {
                        console.log('[RegionSelector] onRegionChange to All Regions');
                        onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
                        return;
                    }
                    const region = regions.find(r => String(r.regionID) === regionID);
                    if (region) {
                        console.log('[RegionSelector] onRegionChange', region);
                        onRegionChange?.(region);
                    }
                }}
            >
                {!allowAllRegions && <option value="">-- Select a Region --</option>}
                {allowAllRegions && <option value="all">All Regions</option>}

                {popularRegionsList.length > 0 && (
                    <optgroup label="Popular Regions">
                        {popularRegionsList.map(region => (
                            <option key={region.regionID} value={region.regionID}>
                                {region.regionName}
                            </option>
                        ))}
                    </optgroup>
                )}

                <optgroup label="All Regions (Alphabetical)">
                    {allRegionsList.map(region => (
                        <option key={`all-${region.regionID}`} value={region.regionID}>
                            {region.regionName}
                        </option>
                    ))}
                </optgroup>
            </select>
        </div>
    );
}
