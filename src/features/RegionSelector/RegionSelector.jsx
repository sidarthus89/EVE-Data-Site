import { useEffect, useState } from 'react';
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
                const regionLookup = data.regionLookup || {};

                const regionList = Object.entries(regionLookup).map(([regionID, name]) => ({
                    regionID,
                    name,
                }));

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

    const selectedRegionID =
        selectedRegion === 'all' || selectedRegion == null
            ? 'all'
            : selectedRegion.regionID || selectedRegion;

    const popularRegionOptions = regions.filter(r =>
        popularRegions.includes(r.name)
    );
    const otherRegionOptions = regions.filter(
        r => !popularRegions.includes(r.name)
    );

    const handleChange = (e) => {
        const regionID = e.target.value;
        if (regionID === 'all') {
            onRegionChange?.({ regionName: 'All Regions', regionID: 'all' });
        } else {
            const region = regions.find(r => r.regionID === regionID);
            onRegionChange?.({ regionName: region?.name || regionID, regionID });
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
                            {region.name}
                        </option>
                    ))}
                </optgroup>
            )}

            {otherRegionOptions.length > 0 && (
                <optgroup label="All Other Regions">
                    {otherRegionOptions.map(region => (
                        <option key={region.regionID} value={region.regionID}>
                            {region.name}
                        </option>
                    ))}
                </optgroup>
            )}
        </select>
    );
}