import React, { useState, useEffect } from 'react';

export default function HaulingForm() {
    // State to hold form values
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [minProfit, setMinProfit] = useState(500000);
    const [maxWeight, setMaxWeight] = useState(Number.MAX_SAFE_INTEGER);
    const [minROI, setMinROI] = useState(0.04);
    const [maxBudget, setMaxBudget] = useState(Number.MAX_SAFE_INTEGER);
    const [tax, setTax] = useState(0.045);
    const [systemSecurity, setSystemSecurity] = useState('high_sec,low_sec,null_sec');
    const [structureType, setStructureType] = useState('both');
    const [routeSafety, setRouteSafety] = useState('shortest');
    const [tradePreference, setTradePreference] = useState('sell-buy');
    const [nearbyOnly, setNearbyOnly] = useState(false);
    const [nearbyList, setNearbyList] = useState('');
    const [haulingRequest, setHaulingRequest] = useState(null);

    // Assume universeList and nearbyRegions are available as globals or props
    // For demo, define dummy minimal data:
    const universeList = {
        "jita": { id: "10000002", name: "Jita" },
        "amarr": { id: "10000043", name: "Amarr" },
        "nearby": { id: "nearby", name: "Nearby Regions" },
    };
    const nearbyRegions = {
        "10000002": ["10000043"], // Jita nearby Amarr for demo
        "10000043": ["10000002"],
    };

    // Helper: get region ID from name (lowercase)
    function getRegionIdByName(name) {
        if (!name) return null;
        const key = name.toLowerCase();
        return universeList[key]?.id || null;
    }

    // Helper: get nearby regions list
    function getNumberNearbyRegions(regionName) {
        if (!regionName) return [];
        const id = getRegionIdByName(regionName);
        if (!id) return [];
        const nearbyIds = nearbyRegions[id] || [];
        const nearbyNames = Object.values(universeList)
            .filter(r => nearbyIds.includes(r.id))
            .map(r => r.name);
        nearbyNames.push(regionName);
        return nearbyNames.sort();
    }

    // Update nearby list text on from change or toggle nearbyOnly
    useEffect(() => {
        if (nearbyOnly && from) {
            const nearbyRegionsList = getNumberNearbyRegions(from);
            setNearbyList(nearbyRegionsList.join(', '));
            setTo(`${nearbyRegionsList.length} Nearby Regions`);
        } else {
            setNearbyList('');
            if (to.includes('Nearby Regions')) setTo('');
        }
    }, [from, nearbyOnly]);

    // Format station span with security class (dummy logic)
    function swapTradeHub(station) {
        if (!station) return null;
        const { name, rating = 5, citadel = false } = station;
        const secNum = Math.min(Math.max(Math.round(rating * 10), 0), 10);
        const secClass = `security-code0${secNum}`;
        if (citadel) {
            return <span className={`${secClass} citadel`} title={`Citadel // Security Rating: ${rating.toFixed(2)}`}>{name}*</span>;
        }
        return <span className={secClass} title={`Security Rating: ${rating.toFixed(2)}`}>{name}</span>;
    }

    // On submit handler
    function handleSubmit(e) {
        e.preventDefault();

        if (!from || !to || to.includes("<<")) {
            alert("Please select a valid starting AND ending regions.");
            return;
        }

        const fromId = getRegionIdByName(from);
        const toId = getRegionIdByName(to.replace(/^\d+ Nearby Regions/, '')); // remove nearby count prefix if present

        // Parse trade preferences
        const [fromPref, toPref] = tradePreference.split('-');

        const request = {
            from: `${fromPref}-${fromId}`,
            to: `${toPref}-${toId}`,
            maxBudget: maxBudget || Number.MAX_SAFE_INTEGER,
            maxWeight: maxWeight || Number.MAX_SAFE_INTEGER,
            minProfit: minProfit >= 0 ? minProfit : 500000,
            minROI: minROI || 0.04,
            routeSafety,
            structureType,
            systemSecurity,
            tax,
        };

        setHaulingRequest(request);

        // For demo, just log it:
        console.log('Hauling request:', request);
    }

    // Create the header JSX per your CSS and original logic
    function renderTradeHeader() {
        if (!haulingRequest) return null;

        const minProfitFormatted = haulingRequest.minProfit.toLocaleString();
        const maxWeightFormatted = haulingRequest.maxWeight === Number.MAX_SAFE_INTEGER ? 'Infinite' : haulingRequest.maxWeight.toLocaleString();
        const minROIFormatted = (haulingRequest.minROI * 100).toFixed(2) + '%';
        const maxBudgetFormatted = haulingRequest.maxBudget === Number.MAX_SAFE_INTEGER ? 'Infinite' : haulingRequest.maxBudget.toLocaleString();
        const taxFormatted = (haulingRequest.tax * 100).toFixed(2) + '%';

        // Simplified structureType and systemSecurity mapping
        const structureTypeText = {
            citadel: 'Player Only',
            npc: 'NPC Only',
            both: 'NPC and Player',
        }[haulingRequest.structureType] || 'NPC and Player';

        let systemSecurityText = 'Only High';
        if (haulingRequest.systemSecurity === 'high_sec,low_sec,null_sec') systemSecurityText = 'High, Low, and Null';
        else if (haulingRequest.systemSecurity === 'high_sec,low_sec') systemSecurityText = 'High and Low';

        const routeSafetyText = haulingRequest.routeSafety
            .replace('secure', 'Safest')
            .replace('insecure', 'Least Safe')
            .replace('shortest', 'Shortest');

        const [fromPref, toPref] = tradePreference.split('-');
        const fromCap = fromPref.charAt(0).toUpperCase() + fromPref.slice(1);
        const toCap = toPref.charAt(0).toUpperCase() + toPref.slice(1);

        return (
            <>
                <h2 className="header-row">
                    <div className="col-sm-12 col-md-6">
                        <ul id="fromRegion" className="hauling-list header-list">
                            <p>Buying From</p>
                            <li>{from}</li>
                        </ul>
                    </div>
                    <div className="col-sm-12 col-md-6">
                        <ul id="toRegion" className="hauling-list header-list">
                            <p>Selling To</p>
                            <li>{to}</li>
                        </ul>
                    </div>
                </h2>
                <h3>
                    <b>Profit&nbsp;Above:</b>&nbsp;{minProfitFormatted} | <b>Capacity:</b>&nbsp;{maxWeightFormatted} | <b>R.O.I.:</b>&nbsp;{minROIFormatted} | <b>Budget:</b>&nbsp;{maxBudgetFormatted}
                    <br />
                    <b>Sales&nbsp;Tax:</b>&nbsp;{taxFormatted} | <b>Security:</b>&nbsp;{systemSecurityText} | <b>Route:</b>&nbsp;{routeSafetyText}
                    <br />
                    <b>Trade Preference:</b>&nbsp;{fromCap} Orders to {toCap} Orders | <b>Structures:</b>&nbsp;{structureTypeText}
                </h3>
            </>
        );
    }

    return (
        <div>
            <form className="hauling-form" onSubmit={handleSubmit}>
                <label htmlFor="from">From Region</label>
                <input
                    list="regionList"
                    id="from"
                    name="from"
                    value={from}
                    onChange={e => setFrom(e.target.value)}
                    placeholder="Enter Starting Region"
                    autoComplete="off"
                    required
                />

                <label htmlFor="to">To Region</label>
                <input
                    list="regionList"
                    id="to"
                    name="to"
                    value={to}
                    onChange={e => setTo(e.target.value)}
                    placeholder="Enter Destination Region"
                    autoComplete="off"
                    disabled={nearbyOnly}
                    required={!nearbyOnly}
                />

                <datalist id="regionList">
                    {Object.values(universeList).map(region => (
                        <option key={region.id} value={region.name} />
                    ))}
                </datalist>

                <div className="suggestions">
                    <label>
                        <input
                            type="checkbox"
                            checked={nearbyOnly}
                            onChange={e => setNearbyOnly(e.target.checked)}
                            id="nearbyOnly"
                        />{' '}
                        Use Nearby Regions Only
                    </label>
                    {nearbyList && <div>Regions Include: {nearbyList}</div>}
                </div>

                <label htmlFor="minProfit">Profit Above</label>
                <input
                    type="number"
                    id="minProfit"
                    value={minProfit}
                    onChange={e => setMinProfit(Number(e.target.value))}
                    min={0}
                />

                <label htmlFor="maxWeight">Max Weight</label>
                <input
                    type="number"
                    id="maxWeight"
                    value={maxWeight === Number.MAX_SAFE_INTEGER ? '' : maxWeight}
                    onChange={e => setMaxWeight(e.target.value ? Number(e.target.value) : Number.MAX_SAFE_INTEGER)}
                    placeholder="Infinite"
                    min={0}
                />

                <label htmlFor="minROI">Min ROI (%)</label>
                <input
                    type="number"
                    id="minROI"
                    step="0.01"
                    value={minROI * 100}
                    onChange={e => setMinROI(Number(e.target.value) / 100)}
                    min={0}
                    max={100}
                />

                <label htmlFor="maxBudget">Max Budget</label>
                <input
                    type="number"
                    id="maxBudget"
                    value={maxBudget === Number.MAX_SAFE_INTEGER ? '' : maxBudget}
                    onChange={e => setMaxBudget(e.target.value ? Number(e.target.value) : Number.MAX_SAFE_INTEGER)}
                    placeholder="Infinite"
                    min={0}
                />

                <label htmlFor="tax">Sales Tax (%)</label>
                <input
                    type="number"
                    id="tax"
                    step="0.01"
                    value={tax * 100}
                    onChange={e => setTax(Number(e.target.value) / 100)}
                    min={0}
                    max={100}
                />

                <label htmlFor="systemSecurity">System Security</label>
                <select id="systemSecurity" value={systemSecurity} onChange={e => setSystemSecurity(e.target.value)}>
                    <option value="high_sec,low_sec,null_sec">High, Low, and Null</option>
                    <option value="high_sec,low_sec">High and Low</option>
                    <option value="high_sec">Only High</option>
                </select>

                <label htmlFor="structureType">Structure Type</label>
                <select id="structureType" value={structureType} onChange={e => setStructureType(e.target.value)}>
                    <option value="both">NPC and Player</option>
                    <option value="citadel">Player Only</option>
                    <option value="npc">NPC Only</option>
                </select>

                <label htmlFor="routeSafety">Route Safety</label>
                <select id="routeSafety" value={routeSafety} onChange={e => setRouteSafety(e.target.value)}>
                    <option value="shortest">Shortest</option>
                    <option value="secure">Safest</option>
                    <option value="insecure">Least Safe</option>
                </select>

                <label htmlFor="tradePreference">Trade Preference</label>
                <select id="tradePreference" value={tradePreference} onChange={e => setTradePreference(e.target.value)}>
                    <option value="sell-buy">Sell to Buy</option>
                    <option value="buy-sell">Buy to Sell</option>
                </select>

                <button type="submit" id="submit" className="btn btn-grey btn-border btn-effect small-btn">Submit</button>
            </form>

            {/* Header showing selected trade info */}
            {renderTradeHeader()}
        </div>
    );
}
