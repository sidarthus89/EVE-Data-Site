// src/features/Ores/OreFilters.jsx

import React from 'react';

const OreFilters = ({
    amount,
    setAmount,
    refineYield,
    setRefineYield,
    priceType,
    setPriceType
}) => {
    const handleYieldChange = (e) => {
        const value = e.target.value.replace('%', '');
        const parsed = parseFloat(value);
        setRefineYield(isNaN(parsed) ? 0 : parsed > 1 ? parsed / 100 : parsed);
    };

    return (
        <div className="flex flex-wrap items-center gap-4 bg-zinc-900 p-4 rounded-xl shadow-md">
            <div className="flex flex-col">
                <label className="text-sm text-gray-300 mb-1">Amount</label>
                <input
                    type="number"
                    value={amount}
                    min="0"
                    step="1"
                    className="px-2 py-1 rounded bg-zinc-800 text-white w-24"
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                />
            </div>

            <div className="flex flex-col">
                <label className="text-sm text-gray-300 mb-1">Refining Yield</label>
                <input
                    type="text"
                    value={(refineYield * 100).toFixed(2) + '%'}
                    className="px-2 py-1 rounded bg-zinc-800 text-white w-24"
                    onChange={handleYieldChange}
                />
            </div>

            <div className="flex flex-col">
                <label className="text-sm text-gray-300 mb-1">Market Price Type</label>
                <select
                    value={priceType}
                    onChange={(e) => setPriceType(e.target.value)}
                    className="px-2 py-1 rounded bg-zinc-800 text-white w-48"
                >
                    <option value="highest_buy">Highest Buy </option>
                    <option value="average_buy">Average Buy</option>
                    <option value="lowest_sell">Lowest Sell</option>
                    {/* Add more if you support percentile pricing */}
                </select>
            </div>
        </div>
    );
};

export default OreFilters;
