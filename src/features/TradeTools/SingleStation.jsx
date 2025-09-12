// src/features/TradeTools/SingleStation.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import RegionSelector from '../../components/RegionSelector/RegionSelector.jsx';
import { getSecurityColor } from '../../utils/common.js';
import { fetchMarketOrders } from '../../utils/market.js';
import { fetchMarketTree, fetchRegions, fetchStationsNPC, fetchStructures, fetchRegionOrdersSnapshot } from '../../utils/api.js';
import './RegionHauling.css';

// Lightweight number formatter
const formatNumber = (value, decimals = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const SALES_TAX_OPTIONS = [
    { level: 0, tax: 7.5, label: 'No Skill: 7.5%' },
    { level: 1, tax: 6.675, label: 'Lvl I: 6.675%' },
    { level: 2, tax: 5.85, label: 'Lvl II: 5.85%' },
    { level: 3, tax: 5.025, label: 'Lvl III: 5.025%' },
    { level: 4, tax: 4.2, label: 'Lvl IV: 4.2%' },
    { level: 5, tax: 3.375, label: 'Lvl V: 3.375%' }
];

const INITIAL_FORM = {
    region: null,
    stationId: '',
    minProfit: '100000',
    minROI: 2,
    salesTax: 7.5,
    maxTypes: 300,
};

export default function SingleStation() {
    const [form, setForm] = useState(INITIAL_FORM);
    const [regionsData, setRegionsData] = useState(null);
    const [stations, setStations] = useState([]); // NPC stations
    const [structures, setStructures] = useState([]); // Player structures
    const [stationFilter, setStationFilter] = useState('');
    const [selectedStation, setSelectedStation] = useState(null);

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [sort, setSort] = useState({ key: 'Net Profit', dir: 'desc' });
    const [page, setPage] = useState(1);
    const [itemsPerPage] = useState(50);

    // Reuse table CSS and column layout approach from RegionHauling
    const columns = [
        'Item', 'Station', 'Best Sell', 'Best Buy', 'Spread', 'Quantity', 'ROI', 'Net Profit'
    ];
    const [colWidths, setColWidths] = useState({
        'Item': 200,
        'Station': 240,
        'Best Sell': 140,
        'Best Buy': 140,
        'Spread': 120,
        'Quantity': 110,
        'ROI': 90,
        'Net Profit': 150,
    });
    const tableContainerRef = useRef(null);
    const containerWidthRef = useRef(0);

    const startResize = (key, startX, startWidth) => {
        const onMove = (e) => {
            const dx = (e.clientX || 0) - startX;
            setColWidths(prev => {
                const minW = 60, maxW = 800;
                const proposed = Math.round(startWidth + dx);
                const keys = Object.keys(prev);
                let total = 0; keys.forEach(k => total += Number(prev[k]) || 0);
                const current = Number(prev[key]) || 0;
                const containerW = containerWidthRef.current || 0;
                const availableGrow = Math.max(0, containerW - total);
                let capped = proposed;
                if (proposed > current) capped = Math.min(proposed, current + availableGrow);
                const next = Math.max(minW, Math.min(maxW, capped));
                return { ...prev, [key]: next };
            });
        };
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const HeaderCell = ({ label }) => {
        const width = colWidths[label] || 120;
        return (
            <th onClick={() => handleSort(label)} style={{ width, minWidth: width, maxWidth: width, position: 'relative' }}>
                {label}{sort.key === label ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                <span
                    className="col-resizer"
                    onMouseDown={(e) => { e.stopPropagation(); startResize(label, e.clientX || 0, width); }}
                    title="Drag to resize"
                />
            </th>
        );
    };
    const cellStyle = (label) => { const w = colWidths[label] || 120; return { width: w, minWidth: w, maxWidth: w }; };

    // Load regions and location datasets
    useEffect(() => {
        fetchRegions().then(setRegionsData).catch(() => setError('Failed to load regions'));
        Promise.all([fetchStationsNPC(), fetchStructures()]).then(([s, t]) => {
            setStations(s || []);
            setStructures(t || []);
        }).catch(() => setError('Failed to load stations/structures'));
    }, []);

    // Item details lookup from market tree
    const itemIndexRef = useRef(null);
    const getItemDetails = async (typeId) => {
        try {
            if (!itemIndexRef.current) {
                const tree = await fetchMarketTree();
                const map = new Map();
                const walk = (node) => {
                    if (!node || typeof node !== 'object') return;
                    if (Array.isArray(node.items)) {
                        for (const it of node.items) {
                            const id = Number(it.typeID);
                            if (!map.has(id)) map.set(id, { name: it.typeName, volume: it.volume || 0.01 });
                        }
                    }
                    for (const k of Object.keys(node)) if (k !== 'items' && k !== '_info') walk(node[k]);
                };
                walk(tree);
                itemIndexRef.current = map;
            }
            const rec = itemIndexRef.current.get(Number(typeId));
            return { name: rec?.name || `Item ${typeId}`, volume: rec?.volume || 0.01 };
        } catch {
            return { name: `Item ${typeId}`, volume: 0.01 };
        }
    };

    // Build region list in consistent shape used by RegionSelector
    const regions = useMemo(() => {
        if (!regionsData) return [];
        return regionsData.map(r => ({
            regionID: r.region_id || r.regionID,
            regionName: r.region_name || r.regionName || r.name,
            ...r
        }));
    }, [regionsData]);

    // Options filtered by selected region and search string
    const stationOptions = useMemo(() => {
        const rid = Number(form.region?.regionID || 0);
        const all = [];
        if (Array.isArray(stations)) {
            for (const s of stations) {
                if (rid && Number(s.region_id) !== rid) continue;
                all.push({
                    id: Number(s.station_id),
                    name: s.name,
                    systemId: Number(s.system_id),
                    systemName: s.system_name,
                    regionId: Number(s.region_id),
                    regionName: s.region_name,
                    security: Number(s.security_status),
                    kind: 'station'
                });
            }
        }
        if (Array.isArray(structures)) {
            for (const t of structures) {
                if (rid && Number(t.regionID) !== rid) continue;
                all.push({
                    id: Number(t.stationID),
                    name: t.locationName,
                    systemId: Number(t.systemID),
                    systemName: t.systemName,
                    regionId: Number(t.regionID),
                    regionName: t.regionName,
                    security: Number(t.security),
                    kind: 'structure'
                });
            }
        }
        const q = stationFilter.trim().toLowerCase();
        if (!q) return all.slice(0, 500).sort((a, b) => a.name.localeCompare(b.name));
        return all.filter(o => (
            o.name.toLowerCase().includes(q) ||
            (o.systemName || '').toLowerCase().includes(q) ||
            String(o.id).includes(q)
        )).slice(0, 500).sort((a, b) => a.name.localeCompare(b.name));
    }, [stations, structures, form.region, stationFilter]);

    // When station selection changes, derive selectedStation object
    useEffect(() => {
        if (!form.stationId) { setSelectedStation(null); return; }
        const id = Number(form.stationId);
        const match = stationOptions.find(o => Number(o.id) === id);
        setSelectedStation(match || null);
    }, [form.stationId, stationOptions]);

    const handleSort = (key) => {
        setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
    };

    const sortedResults = useMemo(() => {
        const arr = [...results];
        const key = sort.key, dir = sort.dir;
        const get = (row) => {
            switch (key) {
                case 'Item': return row.Item || '';
                case 'Station': return row.Station?.name || '';
                case 'Best Sell': return row['Best Sell'] || 0;
                case 'Best Buy': return row['Best Buy'] || 0;
                case 'Spread': return row['Spread'] || 0;
                case 'Quantity': return row['Quantity'] || 0;
                case 'ROI': return row['ROI'] || 0;
                case 'Net Profit': return row['Net Profit'] || 0;
                default: return 0;
            }
        };
        arr.sort((a, b) => {
            const av = get(a), bv = get(b);
            if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
            return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
        return arr;
    }, [results, sort]);

    // Measure container width for column resizing bounds
    useEffect(() => {
        const measure = () => { const el = tableContainerRef.current; if (el) containerWidthRef.current = el.clientWidth; };
        measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
    }, [sortedResults.length]);

    // Core: find in-station flips using region snapshot to seed typeIds
    const handleSearch = async (e) => {
        e.preventDefault();
        setError(null); setResults([]); setProgress(0); setPage(1);
        if (!form.region?.regionID) { setError('Select a region'); return; }
        if (!form.stationId) { setError('Select a station/structure'); return; }
        setLoading(true);

        try {
            const regionId = Number(form.region.regionID);
            const stationId = Number(form.stationId);
            let seedTypeIds = [];
            try {
                const snap = await fetchRegionOrdersSnapshot(regionId);
                if (snap && snap.best_quotes) {
                    for (const [t, entry] of Object.entries(snap.best_quotes)) {
                        const bb = entry?.best_buy, bs = entry?.best_sell;
                        if ((bb && Number(bb.location_id) === stationId) || (bs && Number(bs.location_id) === stationId)) {
                            seedTypeIds.push(Number(t));
                        }
                    }
                }
            } catch { /* snapshot may be missing; continue with empty seed */ }

            // If no seed types, we can stop early; scanning all items would be too heavy
            if (seedTypeIds.length === 0) {
                setError('No active orders detected for this station in the region snapshot. Try another station or region.');
                setLoading(false);
                return;
            }

            // Cap to maxTypes
            const maxTypes = Math.max(10, Number(form.maxTypes) || 300);
            seedTypeIds = seedTypeIds.slice(0, maxTypes);

            const found = [];
            const concurrency = 6;
            let completed = 0;

            const worker = async (ids) => {
                for (const typeId of ids) {
                    try {
                        const { buyOrders = [], sellOrders = [] } = await fetchMarketOrders(typeId, regionId, stationId, null);
                        if ((buyOrders.length + sellOrders.length) === 0) { completed++; setProgress(Math.round((completed / seedTypeIds.length) * 100)); continue; }
                        // Compute best at this station
                        const bestBuy = buyOrders.reduce((m, o) => o.price > (m?.price || -Infinity) ? o : m, null);
                        const bestSell = sellOrders.reduce((m, o) => o.price < (m?.price || Infinity) ? o : m, null);
                        if (!bestBuy || !bestSell) { completed++; setProgress(Math.round((completed / seedTypeIds.length) * 100)); continue; }
                        const unitProfit = Number(bestBuy.price) - Number(bestSell.price);
                        if (unitProfit <= 0) { completed++; setProgress(Math.round((completed / seedTypeIds.length) * 100)); continue; }
                        const qty = Math.min(Number(bestBuy.volume_remain || 0), Number(bestSell.volume_remain || 0));
                        if (qty <= 0) { completed++; setProgress(Math.round((completed / seedTypeIds.length) * 100)); continue; }
                        const { name, volume } = await getItemDetails(typeId);
                        const gross = unitProfit * qty;
                        const tax = (Number(form.salesTax) / 100) * Number(bestBuy.price) * qty; // tax on revenue
                        const net = gross - tax;
                        const roi = Number(bestSell.price) > 0 ? (unitProfit / Number(bestSell.price)) * 100 : 0;
                        // Filters
                        const meetsProfit = net >= Number(form.minProfit || 0);
                        const meetsRoi = roi >= Number(form.minROI || 0);
                        if (meetsProfit && meetsRoi) {
                            found.push({
                                Item: name,
                                Station: { name: selectedStation?.name || String(stationId), security: selectedStation?.security },
                                'Best Sell': Number(bestSell.price),
                                'Best Buy': Number(bestBuy.price),
                                'Spread': unitProfit,
                                'Quantity': qty,
                                'ROI': roi,
                                'Net Profit': net,
                                _raw: { typeId, volume, bestBuy, bestSell }
                            });
                        }
                    } catch {
                        // ignore per-type failures
                    } finally {
                        completed++;
                        setProgress(Math.round((completed / seedTypeIds.length) * 100));
                    }
                }
            };

            // Split work
            const buckets = Array.from({ length: concurrency }, () => []);
            seedTypeIds.forEach((t, i) => buckets[i % concurrency].push(t));
            await Promise.all(buckets.map(bucket => worker(bucket)));

            setResults(found);
        } catch (e) {
            setError(e?.message || 'Search failed');
        } finally {
            setLoading(false);
        }
    };

    if (!regionsData) {
        return (
            <div className="region-hauling">
                <div className="loading-container"><p>Loading regions…</p></div>
            </div>
        );
    }

    return (
        <div className="region-hauling">
            <div className="static-header">
                <div className="page-header">
                    <h1>Single Station Flips</h1>
                    <p className="disclaimer">Find items where in-station buy orders exceed sell prices at the same location.</p>
                </div>
            </div>

            <div className="scrollable-content">
                <div className="hauling-form">
                    <form onSubmit={handleSearch}>
                        <div className="form-container">
                            <div className="form-row top-row-fixed-6">
                                <div className="form-group region-group">
                                    <label>Region</label>
                                    <RegionSelector
                                        selectedRegion={form.region}
                                        onRegionChange={(r) => { setForm(f => ({ ...f, region: r })); setStationFilter(''); setForm(f => ({ ...f, stationId: '' })); }}
                                        allowAllRegions={false}
                                    />
                                </div>

                                <div className="form-group" style={{ flex: 2 }}>
                                    <label>Station/Structure</label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Type to filter by name, system, or ID…"
                                        value={stationFilter}
                                        onChange={(e) => setStationFilter(e.target.value)}
                                    />
                                    <select
                                        className="form-control"
                                        size={8}
                                        value={String(form.stationId || '')}
                                        onChange={(e) => setForm(f => ({ ...f, stationId: e.target.value }))}
                                    >
                                        <option value="" disabled>{stationOptions.length === 0 ? 'No locations' : 'Select a location…'}</option>
                                        {stationOptions.map(opt => (
                                            <option key={opt.id} value={String(opt.id)}>
                                                {opt.name} — {opt.systemName} ({opt.kind === 'station' ? 'NPC' : 'Player'}) [{opt.id}]
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Sales Tax</label>
                                    <select
                                        value={form.salesTax}
                                        onChange={(e) => setForm(f => ({ ...f, salesTax: Number(e.target.value) }))}
                                        className="form-control"
                                    >
                                        {SALES_TAX_OPTIONS.map(o => <option key={o.level} value={o.tax}>{o.label}</option>)}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Min Profit</label>
                                    <input
                                        type="number"
                                        className="form-control"
                                        value={form.minProfit}
                                        onChange={(e) => setForm(f => ({ ...f, minProfit: e.target.value }))}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Min ROI %</label>
                                    <input
                                        type="number"
                                        className="form-control"
                                        value={form.minROI}
                                        onChange={(e) => setForm(f => ({ ...f, minROI: Number(e.target.value) }))}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Max Types</label>
                                    <input
                                        type="number"
                                        className="form-control"
                                        value={form.maxTypes}
                                        onChange={(e) => setForm(f => ({ ...f, maxTypes: Number(e.target.value) }))}
                                        title="Cap on item types scanned from the snapshot seed"
                                    />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="error-message">{error}</div>
                        )}

                        <div className="form-actions">
                            <div className="primary-actions">
                                <div className="buttons-row">
                                    <button
                                        type="submit"
                                        className="eve-button primary-search-btn"
                                        disabled={loading || !form.region || !form.stationId}
                                    >
                                        {loading ? `Searching…${progress}%` : 'Find In-Station Flips'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>

                {results.length > 0 && (
                    <div className="results-container">
                        <div className="results-header">
                            <h2>Results ({results.length} found)</h2>
                            <button className="eve-button clear-results-btn" type="button" onClick={() => setResults([])}>Clear Results</button>
                        </div>
                        <div className="results-table-container" ref={tableContainerRef}>
                            <table className="results-table wide-table" style={{ tableLayout: 'fixed', width: '100%', maxWidth: '100%' }}>
                                <colgroup>
                                    {columns.map(key => (
                                        <col key={key} style={{ width: `${colWidths[key]}px`, minWidth: `${colWidths[key]}px` }} />
                                    ))}
                                </colgroup>
                                <thead>
                                    <tr>
                                        {columns.map(c => <HeaderCell key={c} label={c} />)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        const start = (page - 1) * itemsPerPage;
                                        const pageRows = sortedResults.slice(start, start + itemsPerPage);
                                        return pageRows.map((row, idx) => (
                                            <tr key={start + idx}>
                                                <td style={{ ...cellStyle('Item'), whiteSpace: 'normal' }}>{row.Item}</td>
                                                <td style={{ ...cellStyle('Station'), whiteSpace: 'normal' }}>
                                                    <span style={{ color: getSecurityColor(row.Station?.security) }}>{row.Station?.name || ''}</span>
                                                </td>
                                                <td style={cellStyle('Best Sell')}>{formatNumber(row['Best Sell'], 2)}</td>
                                                <td style={cellStyle('Best Buy')}>{formatNumber(row['Best Buy'], 2)}</td>
                                                <td style={cellStyle('Spread')}>{formatNumber(row['Spread'], 2)}</td>
                                                <td style={cellStyle('Quantity')}>{formatNumber(row['Quantity'], 0)}</td>
                                                <td style={cellStyle('ROI')}>{formatNumber(row['ROI'], 2)}%</td>
                                                <td style={cellStyle('Net Profit')}>{formatNumber(row['Net Profit'], 2)}</td>
                                            </tr>
                                        ));
                                    })()}
                                </tbody>
                            </table>
                        </div>
                        {sortedResults.length > itemsPerPage && (
                            <div className="pagination-container">
                                <div className="pagination">
                                    <button className="pagination-btn" type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
                                    <div className="pagination-info">Page {page} of {Math.ceil(sortedResults.length / itemsPerPage)}</div>
                                    <button className="pagination-btn" type="button" onClick={() => setPage(p => Math.min(Math.ceil(sortedResults.length / itemsPerPage), p + 1))} disabled={page === Math.ceil(sortedResults.length / itemsPerPage)}>Next</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

