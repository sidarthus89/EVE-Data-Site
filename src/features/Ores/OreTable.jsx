

import React, { useEffect, useState, useContext } from 'react';
import oresData from './ores_minerals.json';
import RegionSelector from './../RegionSelector/RegionSelector.jsx';

const mineralTypeIDs = {
    34: 'Tritanium',
    35: 'Pyerite',
    36: 'Mexallon',
    37: 'Isogen',
    38: 'Nocxium',
    39: 'Zydrine',
    40: 'Megacyte',
    11399: 'Morphite'
};

export default function OreTable({ prices, amount, refineYield }) {
    const calculateRefinedValue = (ore) => {
        return ore.refined_output.reduce((sum, output) => {
            const price = prices[output.typeID] || 0;
            return sum + output.quantity * amount * refineYield * price;
        }, 0);
    };

    return (
        <table>
            <thead>
                <tr>
                    <th>Ore</th>
                    {Object.values(mineralTypeIDs).map(mineral => <th key={mineral}>{mineral}</th>)}
                    <th>Refined Value (ISK)</th>
                </tr>
            </thead>
            <tbody>
                {oresData.ores.map(ore => (
                    <tr key={ore.name}>
                        <td>{ore.name}</td>
                        {Object.keys(mineralTypeIDs).map(id => {
                            const output = ore.refined_output.find(m => m.typeID.toString() === id);
                            return <td key={id}>{output ? output.quantity * amount * refineYield : ''}</td>;
                        })}
                        <td>{calculateRefinedValue(ore).toFixed(2)} ISK</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}