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
}