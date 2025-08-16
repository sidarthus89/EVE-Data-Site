import { useEffect, useState, useMemo } from 'react';
import { fetchJSON } from '../../api/esiAPI';
import { fetchLocations } from '../../api/esiAPI';

const popularRegions = [
    'The Forge',
    'Domain',
    'Tenerifis',
    'Sinq Laison',
    'Essence',
];

export default function RegionSelector({ selectedRegion, onRegionChange }) {
    const [regions, setRegions] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function loadRegions() {
            try {
                const data = await fetchLocations();
                const regionList = Object.entries(data || {})
                    .map(([regionName, regionBlock]) => ({
                        regionID: regionBlock.regionID,
                        regionName,
                    }))
                    .filter(r => r.regionID);

                if (regionList.length === 0) {
                    console.warn('RegionSelector: No regions found in fetched data:', data);
                    setError('No regions found. Please check your data source.');
                } else {
                    setError(null);
                    setRegions(regionList);
                }
            } catch (err) {
                console.error('❌ Failed to load regions:', err);
                setError('Failed to load regions.');
                setRegions([]);
            }
        }

        loadRegions();
    }, []); // ← only run once on mount

    useEffect(() => {
        if (!selectedRegion && regions.length > 0) {
            onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
        }
    }, [selectedRegion, regions]);

    // Group regions into popular and others
    const { popularRegionsList, otherRegionsList } = useMemo(() => {
        const popular = regions.filter(r => popularRegions.includes(r.regionName));
        const others = regions.filter(r => !popularRegions.includes(r.regionName));
        return {
            popularRegionsList: popular,
            otherRegionsList: others
        };
    }, [regions]);

    // Render fallback UI if error or empty
    if (error) {
        return <div style={{ color: 'red', padding: '1rem' }}>{error}</div>;
    }
    if (regions.length === 0) {
        return <div style={{ padding: '1rem' }}>Loading regions...</div>;
    }

    // Render dropdown UI with grouped options
    return (
        <div style={{ padding: '1rem' }}>
            <label htmlFor="region-select" style={{ marginRight: 8 }}>Region:</label>
            <select
                id="region-select"
                value={selectedRegion?.regionID || 'all'}
                onChange={e => {
                    const regionID = e.target.value;
                    const region = regions.find(r => String(r.regionID) === regionID);
                    if (region) {
                        onRegionChange?.(region);
                    } else {
                        onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
                    }
                }}
            >
                <option value="all">All Regions</option>

                {popularRegionsList.length > 0 && (
                    <optgroup label="Popular Regions">
                        {popularRegionsList.map(region => (
                            <option key={region.regionID} value={region.regionID}>
                                {region.regionName}
                            </option>
                        ))}
                    </optgroup>
                )}

                {otherRegionsList.length > 0 && (
                    <optgroup label="All Other Regions">
                        {otherRegionsList.map(region => (
                            <option key={region.regionID} value={region.regionID}>
                                {region.regionName}
                            </option>
                        ))}
                    </optgroup>
                )}
            </select>
        </div>
    );
}