// src/features/TradeTools/StaitonFlip.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import RegionSelector from '../../components/RegionSelector/RegionSelector.jsx';
import { getSecurityColor } from '../../utils/common.js';
import { fetchMarketOrders } from '../../utils/market.js';
import { fetchMarketTree, fetchRegions, fetchStationsNPC, fetchStructures, fetchRegionOrdersSnapshot } from '../../utils/api.js';
import './RegionHauling.css';

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
    maxBudget: '',
};

export default function StationFlip() {
    const [form, setForm] = useState(INITIAL_FORM);
    const [regionsData, setRegionsData] = useState(null);
    const [stations, setStations] = useState([]);
    const [structures, setStructures] = useState([]);
    const [stationFilter, setStationFilter] = useState('');
    const [selectedStation, setSelectedStation] = useState(null);
    const [snapshotIds, setSnapshotIds] = useState(null); // Set<number> of location_ids from region snapshot
    const [comboOpen, setComboOpen] = useState(false);
    const comboRef = useRef(null);
    const inputRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState(null);
    const [results, setResults] = useState([]);
    const [sort, setSort] = useState({ key: 'Net Profit', dir: 'desc' });
    const [page, setPage] = useState(1);
    const [itemsPerPage] = useState(50);

    const columns = ['Item', 'Station', 'Best Sell', 'Best Buy', 'Spread', 'Quantity', 'ROI', 'Net Profit'];
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
                <span className="col-resizer" onMouseDown={(e) => { e.stopPropagation(); startResize(label, e.clientX || 0, width); }} title="Drag to resize" />
            </th>
        );
    };
    const cellStyle = (label) => { const w = colWidths[label] || 120; return { width: w, minWidth: w, maxWidth: w }; };

    // Load regions and base location datasets
    useEffect(() => {
        fetchRegions().then(setRegionsData).catch(() => setError('Failed to load regions'));
        Promise.all([fetchStationsNPC(), fetchStructures()])
            .then(([s, t]) => { setStations(s || []); setStructures(t || []); })
            .catch(() => setError('Failed to load stations/structures'));
    }, []);

    // Fetch region snapshot when region changes; derive set of location_ids referenced
    useEffect(() => {
        setSelectedStation(null);
        setForm(f => ({ ...f, stationId: '' }));
        setSnapshotIds(null);
        if (!form.region?.regionID) return;
        let cancelled = false;
        (async () => {
            try {
                const snap = await fetchRegionOrdersSnapshot(Number(form.region.regionID));
                if (cancelled) return;
                const ids = new Set();
                if (snap && snap.best_quotes) {
                    for (const entry of Object.values(snap.best_quotes)) {
                        const bb = entry?.best_buy; const bs = entry?.best_sell;
                        if (bb?.location_id != null) ids.add(Number(bb.location_id));
                        if (bs?.location_id != null) ids.add(Number(bs.location_id));
                    }
                }
                setSnapshotIds(ids);
            } catch {
                setSnapshotIds(new Set());
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.region?.regionID]);

    // Item details index
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
        } catch { return { name: `Item ${typeId}`, volume: 0.01 }; }
    };

    // Build map of known locations for quick lookup
    const knownLocations = useMemo(() => {
        const map = new Map();
        for (const s of stations || []) {
            map.set(Number(s.station_id), {
                id: Number(s.station_id),
                name: s.name,
                systemId: Number(s.system_id),
                systemName: s.system_name,
                regionId: Number(s.region_id),
                regionName: s.region_name,
                security: Number(s.security_status),
                kind: 'station',
            });
        }
        for (const t of structures || []) {
            map.set(Number(t.stationID), {
                id: Number(t.stationID),
                name: t.locationName,
                systemId: Number(t.systemID),
                systemName: t.systemName,
                regionId: Number(t.regionID),
                regionName: t.regionName,
                security: Number(t.security),
                kind: 'structure',
            });
        }
        return map;
    }, [stations, structures]);

    // Station/Structure options depend on selected region's snapshot
    const stationOptions = useMemo(() => {
        if (!form.region?.regionID || !snapshotIds) return [];
        const rid = Number(form.region.regionID);
        const list = [];
        for (const id of snapshotIds.values()) {
            const known = knownLocations.get(Number(id));
            if (known && Number(known.regionId) === rid) {
                list.push(known);
            } else {
                // Unknown in our datasets, still offer it
                const looksStructure = Number(id) >= 1_000_000_000_000;
                list.push({
                    id: Number(id),
                    name: looksStructure ? `Unknown Structure (${id})` : `Unknown Station (${id})`,
                    systemId: null,
                    systemName: '',
                    regionId: rid,
                    regionName: '',
                    security: undefined,
                    kind: looksStructure ? 'structure' : 'station'
                });
            }
        }
        const q = stationFilter.trim().toLowerCase();
        const filtered = q
            ? list.filter(o => (
                String(o.id).includes(q) ||
                (o.name || '').toLowerCase().includes(q) ||
                (o.systemName || '').toLowerCase().includes(q)
            ))
            : list;
        return filtered.sort((a, b) => a.name.localeCompare(b.name));
    }, [form.region, snapshotIds, knownLocations, stationFilter]);

    // Selected station object
    useEffect(() => {
        if (!form.stationId) { setSelectedStation(null); return; }
        const id = Number(form.stationId);
        const match = stationOptions.find(o => Number(o.id) === id);
        setSelectedStation(match || null);
    }, [form.stationId, stationOptions]);

    // Close combobox when clicking outside
    useEffect(() => {
        const onDocClick = (e) => {
            if (!comboRef.current) return;
            if (!comboRef.current.contains(e.target)) setComboOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const handleSort = (key) => setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

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

    useEffect(() => {
        const measure = () => { const el = tableContainerRef.current; if (el) containerWidthRef.current = el.clientWidth; };
        measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
    }, [sortedResults.length]);

    // Search using snapshot only (one JSON): only types where both best buy and best sell are at the selected station
    const handleSearch = async (e) => {
        e.preventDefault();
        setError(null); setResults([]); setProgress(0); setPage(1);
        if (!form.region?.regionID) { setError('Select a region'); return; }
        if (!form.stationId) { setError('Select a station/structure'); return; }
        setLoading(true);

        try {
            const regionId = Number(form.region.regionID);
            const stationId = Number(form.stationId);
            const snap = await fetchRegionOrdersSnapshot(regionId);

            if (!snap || !snap.best_quotes) {
                setError('Snapshot missing for selected region.');
                setLoading(false);
                return;
            }

            const entries = Object.entries(snap.best_quotes);
            const candidates = entries.filter(([, entry]) => {
                const bb = entry?.best_buy; const bs = entry?.best_sell;
                return bb && bs && Number(bb.location_id) === stationId && Number(bs.location_id) === stationId;
            });

            if (candidates.length === 0) {
                setError('No in-station flip candidates found in snapshot for this location.');
                setLoading(false);
                return;
            }

            const maxBudget = Number(form.maxBudget) > 0 ? Number(form.maxBudget) : null;
            const found = [];
            let processed = 0;
            for (const [t, entry] of candidates) {
                try {
                    const typeId = Number(t);
                    const bestBuy = entry.best_buy;
                    const bestSell = entry.best_sell;
                    const unitProfit = Number(bestBuy.price) - Number(bestSell.price);
                    if (unitProfit <= 0) { processed++; continue; }
                    let qty = Math.min(Number(bestBuy.volume_remain || 0), Number(bestSell.volume_remain || 0));
                    if (maxBudget) {
                        const affordable = Math.floor(maxBudget / Number(bestSell.price || 1));
                        qty = Math.min(qty, Math.max(0, affordable));
                    }
                    if (qty <= 0) { processed++; continue; }
                    const { name, volume } = await getItemDetails(typeId);
                    const gross = unitProfit * qty;
                    const tax = (Number(form.salesTax) / 100) * Number(bestBuy.price) * qty;
                    const net = gross - tax;
                    const roi = Number(bestSell.price) > 0 ? (unitProfit / Number(bestSell.price)) * 100 : 0;
                    if (net >= Number(form.minProfit || 0) && roi >= Number(form.minROI || 0)) {
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
                } finally {
                    processed++;
                    if (processed % 20 === 0) setProgress(Math.round((processed / candidates.length) * 100));
                }
            }
            setProgress(100);
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
                    <h1>Station Flips</h1>
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
                                        onRegionChange={(r) => { setForm(f => ({ ...f, region: r, stationId: '' })); setStationFilter(''); }}
                                        allowAllRegions={false}
                                    />
                                </div>

                                <div className="form-group" style={{ flex: 2, position: 'relative' }} ref={comboRef}>
                                    <label>Station/Structure</label>
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        className="form-control"
                                        placeholder={!snapshotIds ? 'Select a region to load locations…' : 'Search by name, system, or ID…'}
                                        value={stationFilter}
                                        onFocus={() => { if (snapshotIds && snapshotIds.size > 0) setComboOpen(true); }}
                                        onChange={(e) => { setStationFilter(e.target.value); setForm(f => ({ ...f, stationId: '' })); setComboOpen(true); }}
                                        disabled={!snapshotIds || snapshotIds.size === 0}
                                        aria-haspopup="listbox"
                                        aria-expanded={comboOpen}
                                        role="combobox"
                                    />
                                    {comboOpen && stationOptions.length > 0 && (
                                        <div role="listbox" className="combo-list" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, maxHeight: 260, overflowY: 'auto', background: '#1b1b1b', border: '1px solid #444', borderRadius: 4, marginTop: 4 }}>
                                            {stationOptions.slice(0, 300).map(opt => {
                                                const label = `${opt.name}${opt.systemName ? ' — ' + opt.systemName : ''} (${opt.kind === 'station' ? 'NPC' : 'Player'}) [${opt.id}]`;
                                                return (
                                                    <div
                                                        key={opt.id}
                                                        role="option"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => {
                                                            setForm(f => ({ ...f, stationId: String(opt.id) }));
                                                            setStationFilter(label);
                                                            setComboOpen(false);
                                                            // Focus back to input for continuity
                                                            setTimeout(() => inputRef.current?.blur(), 0);
                                                        }}
                                                        className="combo-item"
                                                        style={{ padding: '6px 10px', cursor: 'pointer' }}
                                                    >
                                                        {label}
                                                    </div>
                                                );
                                            })}
                                            {stationOptions.length > 300 && (
                                                <div style={{ padding: '6px 10px', color: '#aaa' }}>Showing first 300 results…refine your search</div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="form-group">
                                    <label>Sales Tax</label>
                                    <select value={form.salesTax} onChange={(e) => setForm(f => ({ ...f, salesTax: Number(e.target.value) }))} className="form-control">
                                        {SALES_TAX_OPTIONS.map(o => <option key={o.level} value={o.tax}>{o.label}</option>)}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Min Profit</label>
                                    <input type="number" className="form-control" value={form.minProfit} onChange={(e) => setForm(f => ({ ...f, minProfit: e.target.value }))} />
                                </div>

                                <div className="form-group">
                                    <label>Min ROI %</label>
                                    <input type="number" className="form-control" value={form.minROI} onChange={(e) => setForm(f => ({ ...f, minROI: Number(e.target.value) }))} />
                                </div>

                                <div className="form-group">
                                    <label>Max Budget</label>
                                    <input type="number" className="form-control" value={form.maxBudget} onChange={(e) => setForm(f => ({ ...f, maxBudget: e.target.value }))} placeholder="∞" />
                                </div>
                            </div>
                        </div>

                        {error && (<div className="error-message">{error}</div>)}

                        <div className="form-actions">
                            <div className="primary-actions">
                                <div className="buttons-row">
                                    <button type="submit" className="eve-button primary-search-btn" disabled={loading || !form.region || !form.stationId}>
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
                                    {columns.map(key => (<col key={key} style={{ width: `${colWidths[key]}px`, minWidth: `${colWidths[key]}px` }} />))}
                                </colgroup>
                                <thead>
                                    <tr>{columns.map(c => <HeaderCell key={c} label={c} />)}</tr>
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
