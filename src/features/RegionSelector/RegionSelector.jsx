import { useEffect, useState, useMemo } from 'react';
import { fetchJSON } from '../../api/esiAPI';

const popularRegions = [
    'The Forge',
    'Domain',
    'Tenerifis',
    'Sinq Laison',
    'Essence',
];

export default function RegionSelector({ selectedRegion, onRegionChange }) {
    const [regions, setRegions] = useState([]);

    useEffect(() => {
        async function loadRegions() {
            try {
                const data = await fetchJSON('locations');
                const regionList = Object.entries(data || {})
                    .map(([regionName, regionBlock]) => ({
                        regionID: regionBlock.regionID,
                        regionName,
                    }))
                    .filter(r => r.regionID);

                setRegions(regionList);

                if (!selectedRegion) {
                    onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
                }
            } catch (err) {
                console.error('❌ Failed to load regions:', err);
                setRegions([]);
            }
        }

        loadRegions();
    }, [selectedRegion, onRegionChange]);

    const selectedRegionID = useMemo(() => {
        if (!selectedRegion || selectedRegion === 'all') return 'all';
        return typeof selectedRegion === 'object'
            ? selectedRegion.regionID
            : selectedRegion;
    }, [selectedRegion]);

    const popularRegionOptions = useMemo(
        () => regions.filter(r => popularRegions.includes(r.regionName)),
        [regions]
    );

    const otherRegionOptions = useMemo(
        () => regions.filter(r => !popularRegions.includes(r.regionName)),
        [regions]
    );

    const handleChange = (e) => {
        const regionID = e.target.value;
        if (regionID === 'all') {
            onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
        } else {
            const region = regions.find(r => r.regionID === regionID);
            onRegionChange?.({
                regionName: region?.regionName || `Region ${regionID}`,
                regionID,
            });
        }
    };

    return (
        <select
            value={selectedRegionID}
            onChange={handleChange}
            className="region-selector"
        >
            <option value="all">All Regions</option>

            {popularRegionOptions.length > 0 && (
                <optgroup label="Popular Regions">
                    {popularRegionOptions.map(region => (
                        <option key={region.regionID} value={region.regionID}>
                            {region.regionName}
                        </option>
                    ))}
                </optgroup>
            )}

            {otherRegionOptions.length > 0 && (
                <optgroup label="All Other Regions">
                    {otherRegionOptions.map(region => (
                        <option key={region.regionID} value={region.regionID}>
                            {region.regionName}
                        </option>
                    ))}
                </optgroup>
            )}
        </select>
    );
}