// src/components/RegionSelector/RegionSelector.jsx

import { useEffect, useState, useMemo } from 'react';
import './RegionSelector.css';
import { fetchRegions } from '../../utils/api';

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
        async function loadRegionsData() {
            try {
                const regionsArray = await fetchRegions();
                if (!regionsArray || !Array.isArray(regionsArray)) {
                    throw new Error('Invalid regions data format');
                }

                const PLEX_REGION_ID = 19000001;
                const userSelectableRegions = regionsArray.filter(region => region.regionID !== PLEX_REGION_ID);

                setRegions(userSelectableRegions);
                setError(null);
                setIsLoadingFast(false);

            } catch (err) {
                console.error('❌ RegionSelector: Failed to load regions:', err);
                setError(`Failed to load regions: ${err.message}`);
                setRegions([]);
                setIsLoadingFast(false);
            }
        }

        loadRegionsData();
    }, []);

    useEffect(() => {
        if (allowAllRegions && (!selectedRegion || !selectedRegion.regionID) && regions.length > 0) {
            onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
        }
    }, [selectedRegion, regions, onRegionChange, allowAllRegions]);

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
        return <div style={{ padding: '1rem' }}>{loadingText}</div>;
    }

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
                        onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
                        return;
                    }
                    const region = regions.find(r => String(r.regionID) === regionID);
                    if (region) {
                        onRegionChange?.(region);
                    }
                }}
            >
                {!allowAllRegions && <option value="">*Select a Region*</option>}
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
