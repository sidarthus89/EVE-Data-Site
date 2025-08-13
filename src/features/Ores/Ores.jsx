// src/features/Ores/Ores.jsx

import React, { useState, useContext, useEffect } from 'react';
import OreFilters from './OreFilters';
import OreTable from './OreTable';
import RegionSelector from './../RegionSelector/RegionSelector.jsx';
import oresData from './ores_minerals.json';

export function Ores() {
    return (
        <section className="ores">
            <h1>Ores</h1>
            <p>In development</p>
        </section>
    );
}

const OreDashboard = () => {
    const [amount, setAmount] = useState(1);
    const [refineYield, setRefineYield] = useState(1);
    const [priceType, setPriceType] = useState('highest_buy');
    const [prices, setPrices] = useState({});
    const [regionID, setRegionID] = useState('The Forge');


    useEffect(() => {
        const loadPrices = async () => {
            const res = await fetch('/data/cached_prices.json');
            const fetchedPrices = await res.json();
            setPrices(fetchedPrices);
        };

        loadPrices();
    }, [regionID, priceType]);



    return (
        <div className="space-y-4">
            <RegionSelector
                selectedRegion={selectedRegion}
                onRegionChange={({ regionName, regionID }) => {
                    setSelectedRegion(regionName);
                    setSelectedRegionID(regionID);
                }}
            />

            <OreFilters
                amount={amount}
                setAmount={setAmount}
                refineYield={refineYield}
                setRefineYield={setRefineYield}
                priceType={priceType}
                setPriceType={setPriceType}
            />

            <OreTable
                prices={prices}
                amount={amount}
                refineYield={refineYield}
            />
        </div>
    );

};

export default OreDashboard;