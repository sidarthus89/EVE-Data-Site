// src/features/Market/MarketTables.jsx

import { useMemo, useState, useRef, useEffect } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getExpandedRowModel,
    flexRender,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import './MarketTables.css';
import { FiFilter, FiCheck, FiX } from 'react-icons/fi';
import {
    getSecurityColor,
    truncateToOneDecimal,
    capitalizeWords,
    formatExpiresIn,
    formatRange,
    formatISK
} from './../../utils/common.js';

// Copy to clipboard utility
const copyToClipboard = async (text) => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy text: ', err);
        return false;
    }
};

export default function MarketTables({
    sellers,
    buyers,
    selectedRegion,
    locationInfoMap,
    activeTab,
    setActiveTab,
    itemName
}) {

    // Filter/UX state
    const [activeFilterColumns, setActiveFilterColumns] = useState({ seller: null, buyer: null });
    const [filterSearchTerms, setFilterSearchTerms] = useState({ seller: {}, buyer: {} });
    const [tempFilterSelections, setTempFilterSelections] = useState({ seller: {}, buyer: {} });
    const [copiedCells, setCopiedCells] = useState(new Set());
    const filterPanelRef = useRef(null);

    // Table state (sorting, sizing, filters)
    const [tableState, setTableState] = useState({
        sellerSorting: [{ id: 'price', desc: false }],
        buyerSorting: [{ id: 'price', desc: true }],
        sellerSizing: {},
        buyerSizing: {},
        sellerColumnFilters: [],
        buyerColumnFilters: []
    });

    const sellerParentRef = useRef();
    const buyerParentRef = useRef();

    // Close filter panels on outside click/touch
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterPanelRef.current && !filterPanelRef.current.contains(event.target)) {
                setActiveFilterColumns(prev => ({ ...prev, seller: null, buyer: null }));
                setTempFilterSelections(prev => ({ ...prev, seller: {}, buyer: {} }));
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, []);

    // TanStack filter function: accepts array selections
    const excelStyleFilter = (row, columnId, filterValue) => {
        if (!filterValue || filterValue.length === 0) return true;

        let cellValue = row.getValue(columnId);

        if (columnId === 'security') {
            // Normalize to string with one decimal
            const sec = truncateToOneDecimal(Number(cellValue) || 0);
            cellValue = `${sec.toFixed(1)}`;
        } else if (columnId === 'station_type') {
            const locId = Number(row.original.location_id);
            const isNPC = locationInfoMap[locId]?.isNPC ?? (locId < 1000000000000);
            cellValue = isNPC ? 'NPC' : 'Player';
        } else if (columnId === 'location_name') {
            const loc = locationInfoMap[Number(cellValue)];
            cellValue = capitalizeWords(loc?.name || '');
        } else if (columnId === 'region_name') {
            const loc = locationInfoMap[Number(cellValue)];
            cellValue = capitalizeWords(loc?.regionName || '');
        } else if (columnId === 'range') {
            cellValue = formatRange(cellValue);
        }

        return filterValue.includes(String(cellValue));
    };

    // Handle copy for location cells
    const handleCopyLocation = async (locationId, cellId) => {
        const loc = locationInfoMap[Number(locationId)];
        const name = loc?.name;
        if (!name) return;
        const success = await copyToClipboard(name);
        if (success) {
            setCopiedCells(prev => new Set(prev).add(cellId));
            setTimeout(() => {
                setCopiedCells(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(cellId);
                    return newSet;
                });
            }, 2000);
        }
    };

    // Populate filter pickers with unique values
    const getColumnUniqueValues = (data, columnId) => {
        const values = new Set();

        data.forEach(row => {
            if (columnId === 'security') {
                const rawSec = locationInfoMap[Number(row.location_id)]?.security;
                // Don't conflate 0.0 with missing; normalize numbers only
                if (rawSec !== null && rawSec !== undefined) {
                    const sec = truncateToOneDecimal(rawSec);
                    values.add(`${sec.toFixed(1)}`);
                }
            } else if (columnId === 'station_type') {
                const locId = Number(row.location_id);
                const isNPC = locationInfoMap[locId]?.isNPC ?? (locId < 1000000000000);
                values.add(isNPC ? 'NPC' : 'Player');
            } else if (columnId === 'location_name') {
                const locName = locationInfoMap[Number(row.location_id)]?.name;
                if (locName) values.add(capitalizeWords(locName));
            } else if (columnId === 'region_name') {
                const regionName = locationInfoMap[Number(row.location_id)]?.regionName;
                if (regionName) values.add(capitalizeWords(regionName));
            } else if (columnId === 'range') {
                values.add(formatRange(row[columnId]));
            }
        });

        return Array.from(values).sort();
    };

    // Open/Apply/Cancel filter panel
    const openFilterPanel = (tableType, columnId, table) => {
        const currentFilter = table.getColumn(columnId).getFilterValue() || [];
        const data = tableType === 'seller' ? filteredSellers : filteredBuyers;
        const allValues = getColumnUniqueValues(data, columnId);
        const isSelectAll = currentFilter.length === 0;

        setTempFilterSelections(prev => ({
            ...prev,
            [tableType]: {
                ...prev[tableType],
                [columnId]: {
                    selectAll: isSelectAll,
                    selectedValues: isSelectAll ? new Set(allValues) : new Set(currentFilter)
                }
            }
        }));

        setActiveFilterColumns(prev => ({ ...prev, [tableType]: columnId }));
    };

    const applyFilter = (tableType, columnId, table) => {
        const tempSelection = tempFilterSelections[tableType]?.[columnId];
        if (!tempSelection) return;

        const data = tableType === 'seller' ? filteredSellers : filteredBuyers;
        const allValues = getColumnUniqueValues(data, columnId);
        const selectedArray = Array.from(tempSelection.selectedValues);

        const newFilter = selectedArray.length === allValues.length ? [] : selectedArray;
        table.getColumn(columnId).setFilterValue(newFilter);

        setActiveFilterColumns(prev => ({ ...prev, [tableType]: null }));
        setTempFilterSelections(prev => ({
            ...prev,
            [tableType]: {
                ...prev[tableType],
                [columnId]: undefined
            }
        }));
    };

    const cancelFilter = (tableType) => {
        setActiveFilterColumns(prev => ({ ...prev, [tableType]: null }));
        setTempFilterSelections(prev => ({ ...prev, [tableType]: {} }));
    };

    // Header renderer with sort + filter button
    const createHeaderRenderer = (label, tableType, table) => ({ column }) => {
        const canFilter = ['security', 'station_type', 'region_name', 'location_name', 'range'].includes(column.id);
        const isActiveFilter = activeFilterColumns[tableType] === column.id;

        return (
            <div className="header-with-filter">
                <span
                    className="header-text"
                    onClick={() => {
                        const isSorted = column.getIsSorted();
                        if (!isSorted) {
                            column.toggleSorting(false); // ascending
                        } else if (isSorted === 'asc') {
                            column.toggleSorting(true);  // descending
                        } else {
                            column.clearSorting();       // none
                        }
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    {label}
                    {column.getIsSorted() === 'asc' ? ' ▲' : column.getIsSorted() === 'desc' ? ' ▼' : ''}
                </span>
                {canFilter && (
                    <button
                        className="filter-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isActiveFilter) {
                                cancelFilter(tableType);
                            } else {
                                openFilterPanel(tableType, column.id, table);
                            }
                        }}
                        title="Filter column"
                        style={{ position: 'relative' }}
                    >
                        <FiFilter />
                    </button>
                )}
            </div>
        );
    };

    // Region scoping
    const filteredSellers = useMemo(() => {
        if (!selectedRegion || selectedRegion.regionID === 'all') return sellers || [];
        const regionNameTarget = selectedRegion.regionName;
        return (sellers || []).filter(order => {
            const loc = locationInfoMap[Number(order.location_id)];
            return (loc?.regionName || 'Unknown') === regionNameTarget;
        });
    }, [sellers, selectedRegion, locationInfoMap]);

    const filteredBuyers = useMemo(() => {
        if (!selectedRegion || selectedRegion.regionID === 'all') return buyers || [];
        const regionNameTarget = selectedRegion.regionName;
        return (buyers || []).filter(order => {
            const loc = locationInfoMap[Number(order.location_id)];
            return (loc?.regionName || 'Unknown') === regionNameTarget;
        });
    }, [buyers, selectedRegion, locationInfoMap]);

    // Seller columns
    const sellerColumns = useMemo(() => [
        {
            accessorKey: 'volume_remain',
            header: 'Quantity',
            size: 96,
        },
        {
            accessorKey: 'price',
            header: 'Price',
            cell: info => formatISK(info.getValue()),
            size: 160,
        },
        {
            accessorFn: row => {
                const sec = locationInfoMap[Number(row.location_id)]?.security;
                return (sec === null || sec === undefined) ? null : sec;
            },
            id: 'security',
            header: 'Sec.',
            cell: info => {
                const locationId = Number(info.row.original.location_id);
                const rawSec = locationInfoMap[locationId]?.security;
                return typeof rawSec === 'number'
                    ? <span style={{ color: getSecurityColor(rawSec) }}>{rawSec.toFixed(1)}</span>
                    : <span>—</span>;
            },
            size: 78,
        },
        {
            accessorFn: row => {
                const locId = Number(row.location_id);
                const isNPC = locationInfoMap[locId]?.isNPC ?? (locId < 1000000000000);
                return isNPC ? 'NPC' : 'Player';
            },
            id: 'station_type',
            header: 'Type',
            cell: info => {
                const stationType = info.getValue();
                return (
                    <span style={{
                        color: stationType === 'NPC' ? '#4CAF50' : '#2196F3',
                        fontWeight: '500'
                    }}>
                        {stationType}
                    </span>
                );
            },
            size: 65,
        },
        {
            accessorKey: 'location_id',
            id: 'location_name',
            header: 'Location',
            cell: info => {
                const locationId = Number(info.getValue());
                const locName = capitalizeWords(locationInfoMap[locationId]?.name || 'Unknown');
                const cellId = `${info.column.id}-${info.row.id}`;
                const isCopied = copiedCells.has(cellId);
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleCopyLocation(locationId, cellId)}
                            title="Click to copy location name"
                        >
                            {locName}
                        </span>
                        {isCopied && <span style={{ fontSize: '0.8em', color: '#6dd36d' }}>Copied</span>}
                    </div>
                );
            },
            sortingFn: (a, b) => {
                const getKey = (locationID) => {
                    const loc = locationInfoMap[Number(locationID)];
                    if (!loc) return 'zzz';
                    const secKey = (loc.security === null || loc.security === undefined)
                        ? 999
                        : truncateToOneDecimal(loc.security);
                    const nm = (loc.name || '').toLowerCase();
                    return `${secKey}-${nm}`;
                };
                const keyA = getKey(a.original.location_id);
                const keyB = getKey(b.original.location_id);
                return keyA.localeCompare(keyB);
            },
            size: 470,
        },
        {
            accessorKey: 'location_id',
            id: 'region_name',
            header: 'Region',
            cell: info => {
                const regionName = locationInfoMap[Number(info.getValue())]?.regionName || 'Unknown';
                return capitalizeWords(regionName);
            },
            sortingFn: (a, b) => {
                const regionA = locationInfoMap[Number(a.original.location_id)]?.regionName || '';
                const regionB = locationInfoMap[Number(b.original.location_id)]?.regionName || '';
                return regionA.localeCompare(regionB);
            },
            size: 128,
        },
        {
            accessorKey: 'duration',
            header: 'Expires in',
            cell: info => {
                const row = info.row.original || {};
                // Prefer explicit expiry timestamp if present
                const explicitExpiry = row.expires_at || row.expiry || row.expiresAt || null; // ISO string
                let expiryMs = null;
                if (explicitExpiry) {
                    const d = new Date(explicitExpiry);
                    if (!isNaN(d.getTime())) expiryMs = d.getTime();
                }
                if (expiryMs == null) {
                    // Fall back to issued + duration (days)
                    const { issued, duration } = row;
                    if (issued && typeof duration === 'number') {
                        const issuedDate = new Date(issued);
                        if (!isNaN(issuedDate.getTime())) {
                            expiryMs = issuedDate.getTime() + duration * 24 * 60 * 60 * 1000;
                        }
                    }
                }
                if (expiryMs == null && typeof row.duration_seconds === 'number') {
                    // Optional: duration in seconds from now
                    expiryMs = Date.now() + (row.duration_seconds * 1000);
                }
                if (expiryMs == null) return '—';
                const diff = expiryMs - Date.now();
                if (!Number.isFinite(diff)) return '—';
                const diffMinutes = Math.max(Math.floor(diff / 60000), 0);
                return formatExpiresIn(diffMinutes);
            },
            size: 112,
        },
    ], [locationInfoMap, copiedCells]);

    // Buyer columns
    const buyerColumns = useMemo(() => [
        {
            accessorKey: 'min_volume',
            header: 'Min Volume',
            cell: info => (info.getValue() ?? 0).toLocaleString(),
            size: 80,
        },
        {
            accessorKey: 'volume_remain',
            header: 'Quantity',
            size: 96,
        },
        {
            accessorKey: 'price',
            header: 'Price',
            cell: info => formatISK(info.getValue()),
            size: 160,
        },
        {
            accessorFn: row => {
                const sec = locationInfoMap[Number(row.location_id)]?.security;
                return (sec === null || sec === undefined) ? null : sec;
            },
            id: 'security',
            header: 'Sec.',
            cell: info => {
                const locationId = Number(info.row.original.location_id);
                const rawSec = locationInfoMap[locationId]?.security;
                return typeof rawSec === 'number'
                    ? <span style={{ color: getSecurityColor(rawSec) }}>{rawSec.toFixed(1)}</span>
                    : <span>—</span>;
            },
            size: 78,
        },
        {
            accessorFn: row => {
                const locId = Number(row.location_id);
                const isNPC = locationInfoMap[locId]?.isNPC ?? (locId < 1000000000000);
                return isNPC ? 'NPC' : 'Player';
            },
            id: 'station_type',
            header: 'Type',
            cell: info => {
                const stationType = info.getValue();
                return (
                    <span style={{
                        color: stationType === 'NPC' ? '#4CAF50' : '#2196F3',
                        fontWeight: '500'
                    }}>
                        {stationType}
                    </span>
                );
            },
            size: 65,
        },
        {
            accessorKey: 'location_id',
            id: 'location_name',
            header: 'Location',
            cell: info => {
                const locationId = Number(info.getValue());
                const locName = capitalizeWords(locationInfoMap[locationId]?.name || 'Unknown');
                const cellId = `${info.column.id}-${info.row.id}`;
                const isCopied = copiedCells.has(cellId);
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleCopyLocation(locationId, cellId)}
                            title="Click to copy location name"
                        >
                            {locName}
                        </span>
                        {isCopied && <span style={{ fontSize: '0.8em', color: '#6dd36d' }}>Copied</span>}
                    </div>
                );
            },
            sortingFn: (a, b) => {
                const getKey = (locationID) => {
                    const loc = locationInfoMap[Number(locationID)];
                    if (!loc) return 'zzz';
                    const secKey = (loc.security === null || loc.security === undefined)
                        ? 999
                        : truncateToOneDecimal(loc.security);
                    const nm = (loc.name || '').toLowerCase();
                    return `${secKey}-${nm}`;
                };
                const keyA = getKey(a.original.location_id);
                const keyB = getKey(b.original.location_id);
                return keyA.localeCompare(keyB);
            },
            size: 470,
        },
        {
            accessorKey: 'location_id',
            id: 'region_name',
            header: 'Region',
            cell: info => {
                const regionName = locationInfoMap[info.getValue()]?.regionName || 'Unknown';
                return capitalizeWords(regionName);
            },
            sortingFn: (a, b) => {
                const regionA = locationInfoMap[Number(a.original.location_id)]?.regionName || '';
                const regionB = locationInfoMap[Number(b.original.location_id)]?.regionName || '';
                return regionA.localeCompare(regionB);
            },
            size: 128,
        },
        {
            accessorKey: 'range',
            header: 'Range',
            cell: info => formatRange(info.getValue()),
            size: 84,
        },
        {
            accessorKey: 'duration',
            header: 'Expires in',
            cell: info => {
                const row = info.row.original || {};
                const explicitExpiry = row.expires_at || row.expiry || row.expiresAt || null;
                let expiryMs = null;
                if (explicitExpiry) {
                    const d = new Date(explicitExpiry);
                    if (!isNaN(d.getTime())) expiryMs = d.getTime();
                }
                if (expiryMs == null) {
                    const { issued, duration } = row;
                    if (issued && typeof duration === 'number') {
                        const issuedDate = new Date(issued);
                        if (!isNaN(issuedDate.getTime())) {
                            expiryMs = issuedDate.getTime() + duration * 24 * 60 * 60 * 1000;
                        }
                    }
                }
                if (expiryMs == null && typeof row.duration_seconds === 'number') {
                    expiryMs = Date.now() + (row.duration_seconds * 1000);
                }
                if (expiryMs == null) return '—';
                const diff = expiryMs - Date.now();
                if (!Number.isFinite(diff)) return '—';
                const diffMinutes = Math.max(Math.floor(diff / 60000), 0);
                return formatExpiresIn(diffMinutes);
            },
            size: 112,
        },
    ], [locationInfoMap, copiedCells]);

    // Table factory with shared state wiring
    const createTable = (data, columns, sortKey, sizingKey, filtersKey) => {
        const updateState = (updater, key) => {
            setTableState(prev => ({
                ...prev,
                [key]: typeof updater === 'function' ? updater(prev[key]) : updater
            }));
        };

        return useReactTable({
            data,
            columns,
            defaultColumn: {
                minSize: 60,
                maxSize: 600,
                size: undefined,
                enableResizing: true,
                enableColumnFilter: true,
                filterFn: excelStyleFilter,
            },
            columnResizeMode: 'onChange',
            getCoreRowModel: getCoreRowModel(),
            getSortedRowModel: getSortedRowModel(),
            getFilteredRowModel: getFilteredRowModel(),
            getExpandedRowModel: getExpandedRowModel(),
            state: {
                sorting: tableState[sortKey],
                columnSizing: tableState[sizingKey],
                columnFilters: tableState[filtersKey]
            },
            enableSortingRemoval: false,
            onSortingChange: updater => updateState(updater, sortKey),
            onColumnSizingChange: updater => updateState(updater, sizingKey),
            onColumnFiltersChange: updater => updateState(updater, filtersKey),
            getRowId: row => {
                const oid = row.order_id ?? `${row.is_buy_order ? 'B' : 'S'}-${row.type_id}-${row.region_id ?? 'r'}-${row.location_id ?? 'l'}-${row.price}`;
                return String(oid);
            },
        });
    };

    const sellerTable = createTable(
        filteredSellers,
        sellerColumns,
        'sellerSorting',
        'sellerSizing',
        'sellerColumnFilters'
    );

    const buyerTable = createTable(
        filteredBuyers,
        buyerColumns,
        'buyerSorting',
        'buyerSizing',
        'buyerColumnFilters'
    );

    // Averages for headers (optional display)
    const computeAveragePrice = (orders) => {
        if (!orders || orders.length === 0) return null;
        const totalVolume = orders.reduce((sum, o) => sum + (o.volume_remain ?? 0), 0);
        const weightedSum = orders.reduce((sum, o) => sum + (o.price ?? 0) * (o.volume_remain ?? 0), 0);
        return totalVolume > 0 ? weightedSum / totalVolume : null;
    };

    const averageSellPrice = useMemo(() => computeAveragePrice(filteredSellers), [filteredSellers]);
    const averageBuyPrice = useMemo(() => computeAveragePrice(filteredBuyers), [filteredBuyers]);

    // Virtualizers
    const sellerRowVirtualizer = useVirtualizer({
        count: sellerTable.getRowModel().rows.length,
        getScrollElement: () => sellerParentRef.current,
        estimateSize: () => 24,
        overscan: 5,
        initialOffset: 0,
        getItemKey: (index) => sellerTable.getRowModel().rows[index]?.id ?? index,
    });

    const buyerRowVirtualizer = useVirtualizer({
        count: buyerTable.getRowModel().rows.length,
        getScrollElement: () => buyerParentRef.current,
        estimateSize: () => 24,
        overscan: 5,
        initialOffset: 0,
        getItemKey: (index) => buyerTable.getRowModel().rows[index]?.id ?? index,
    });

    // Filter panel UI
    const renderFilterPanel = (tableType, columnId) => {
        const table = tableType === 'seller' ? sellerTable : buyerTable;
        if (activeFilterColumns[tableType] !== columnId) return null;

        const data = tableType === 'seller' ? filteredSellers : filteredBuyers;

        return (
            <div className="filter-panel-enhanced" ref={filterPanelRef}>
                <div className="filter-search-section">
                    <input
                        type="text"
                        placeholder="Search..."
                        className="filter-search-input"
                        value={filterSearchTerms[tableType]?.[columnId] || ''}
                        onChange={e => {
                            const term = e.target.value;
                            setFilterSearchTerms(prev => ({
                                ...prev,
                                [tableType]: { ...prev[tableType], [columnId]: term }
                            }));
                        }}
                    />
                </div>

                <div className="filter-options-list">
                    {(() => {
                        const allValues = getColumnUniqueValues(data, columnId);
                        const tempSelection = tempFilterSelections[tableType]?.[columnId];
                        const searchTerm = filterSearchTerms[tableType]?.[columnId] || '';

                        const filteredValues = allValues.filter(value =>
                            !searchTerm || value.toLowerCase().includes(searchTerm.toLowerCase())
                        );

                        return (
                            <>
                                <label className="filter-select-all-option">
                                    <input
                                        type="checkbox"
                                        checked={tempSelection?.selectAll || false}
                                        onChange={(e) => {
                                            const isSelectAll = e.target.checked;
                                            setTempFilterSelections(prev => ({
                                                ...prev,
                                                [tableType]: {
                                                    ...prev[tableType],
                                                    [columnId]: {
                                                        selectAll: isSelectAll,
                                                        selectedValues: isSelectAll ? new Set(allValues) : new Set()
                                                    }
                                                }
                                            }));
                                        }}
                                    />
                                    (Select All)
                                </label>

                                {filteredValues.map(value => {
                                    const isChecked = tempSelection?.selectedValues?.has(value) || false;
                                    return (
                                        <label key={value} className="filter-option">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                    const newSelectedValues = new Set(tempSelection?.selectedValues || []);
                                                    if (e.target.checked) {
                                                        newSelectedValues.add(value);
                                                    } else {
                                                        newSelectedValues.delete(value);
                                                    }
                                                    const isSelectAll = newSelectedValues.size === allValues.length;
                                                    setTempFilterSelections(prev => ({
                                                        ...prev,
                                                        [tableType]: {
                                                            ...prev[tableType],
                                                            [columnId]: {
                                                                selectAll: isSelectAll,
                                                                selectedValues: newSelectedValues
                                                            }
                                                        }
                                                    }));
                                                }}
                                            />
                                            {value}
                                        </label>
                                    );
                                })}
                            </>
                        );
                    })()}
                </div>

                <div className="filter-actions">
                    <button
                        className="filter-cancel-btn"
                        onClick={() => cancelFilter(tableType)}
                    >
                        <FiX /> Cancel
                    </button>
                    <button
                        className="filter-ok-btn"
                        onClick={() => applyFilter(tableType, columnId, table)}
                    >
                        <FiCheck /> OK
                    </button>
                </div>
            </div>
        );
    };

    // Header wrapper with filter UI
    const createHeader = (label, tableType, table) => ({ column }) => {
        // Sellers do not have Range column anymore; keep range filter only for buyers.
        const canFilter = ['security', 'station_type', 'region_name', 'location_name'].includes(column.id) ||
            (tableType === 'buyer' && column.id === 'range');
        const isActiveFilter = activeFilterColumns[tableType] === column.id;

        return (
            <div className="header-with-filter">
                <span
                    className="header-text"
                    onClick={() => {
                        const state = column.getIsSorted();
                        if (!state) column.toggleSorting(false);
                        else if (state === 'asc') column.toggleSorting(true);
                        else column.clearSorting();
                    }}
                    style={{ cursor: 'pointer' }}
                >
                    {label}
                    {column.getIsSorted() === 'asc' ? ' ▲' : column.getIsSorted() === 'desc' ? ' ▼' : ''}
                </span>
                {canFilter && (
                    <button
                        className="filter-button"
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isActiveFilter) cancelFilter(tableType);
                            else openFilterPanel(tableType, column.id, table);
                        }}
                        title="Filter column"
                    >
                        <FiFilter />
                    </button>
                )}
            </div>
        );
    };

    // Render a table with virtualization and header filter panels
    const renderTable = (title, table, parentRef, rowVirtualizer, tableType) => (
        <div className="market-table-wrapper">
            <h3 className="market-table-title">
                {title} ({table.getRowModel().rows.length} orders)
                {tableType === 'seller' && averageSellPrice !== null && (
                    <span style={{ marginLeft: '1rem', fontWeight: 'normal', fontSize: '0.95em', color: '#ccc' }}>
                        Avg Price: {averageSellPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK
                    </span>
                )}
                {tableType === 'buyer' && averageBuyPrice !== null && (
                    <span style={{ marginLeft: '1rem', fontWeight: 'normal', fontSize: '0.95em', color: '#ccc' }}>
                        Avg Price: {averageBuyPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK
                    </span>
                )}
            </h3>

            <div className="market-table">
                <div className="thead">
                    {table.getHeaderGroups().map(headerGroup => (
                        <div key={headerGroup.id} className="thead-row">
                            {headerGroup.headers.map(header => (
                                <div key={header.id} className="column-header-wrapper">
                                    <div className="column-header" style={{ width: header.getSize() }}>
                                        {header.column.columnDef.Header
                                            ? flexRender(header.column.columnDef.Header, header.getContext())
                                            : createHeader(header.column.columnDef.header, tableType, table)(header.getContext())
                                        }
                                        {header.column.getCanResize() && (
                                            <div
                                                onMouseDown={header.getResizeHandler()}
                                                onTouchStart={header.getResizeHandler()}
                                                className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
                                            />
                                        )}
                                    </div>
                                    {renderFilterPanel(tableType, header.column.id)}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>

                <div ref={parentRef} className="table-body">
                    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                        {rowVirtualizer.getVirtualItems().map(virtualRow => {
                            const row = table.getRowModel().rows[virtualRow.index];
                            return (
                                <div
                                    key={row.id}
                                    className="table-row"
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                >
                                    {row.getVisibleCells().map(cell => (
                                        <div
                                            key={cell.id}
                                            className="table-cell"
                                            style={{ width: cell.column.getSize(), whiteSpace: 'nowrap' }}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );

    // Attach header renderers to columns
    const updatedSellerColumns = useMemo(() =>
        sellerColumns.map(col => ({
            ...col,
            Header: ['security', 'region_name', 'location_name', 'range'].includes(col.id)
                ? createHeader(col.header, 'seller', sellerTable)
                : createHeader(col.header, 'seller', sellerTable)
        })), [sellerColumns, sellerTable]
    );

    const updatedBuyerColumns = useMemo(() =>
        buyerColumns.map(col => ({
            ...col,
            Header: ['security', 'region_name', 'location_name', 'range'].includes(col.id)
                ? createHeader(col.header, 'buyer', buyerTable)
                : createHeader(col.header, 'buyer', buyerTable)
        })), [buyerColumns, buyerTable, filteredBuyers]
    );

    // Rebuild tables with updated headers (keeps filter/sort wiring)
    const sellerTableWithHeaders = useReactTable({
        data: filteredSellers,
        columns: updatedSellerColumns,
        defaultColumn: {
            minSize: 60,
            maxSize: 600,
            size: undefined,
            enableResizing: true,
            enableColumnFilter: true,
            filterFn: excelStyleFilter,
        },
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        state: {
            sorting: tableState.sellerSorting,
            columnSizing: tableState.sellerSizing,
            columnFilters: tableState.sellerColumnFilters
        },
        enableSortingRemoval: false,
        onSortingChange: updater => setTableState(prev => ({ ...prev, sellerSorting: typeof updater === 'function' ? updater(prev.sellerSorting) : updater })),
        onColumnSizingChange: updater => setTableState(prev => ({ ...prev, sellerSizing: typeof updater === 'function' ? updater(prev.sellerSizing) : updater })),
        onColumnFiltersChange: updater => setTableState(prev => ({ ...prev, sellerColumnFilters: typeof updater === 'function' ? updater(prev.sellerColumnFilters) : updater })),
        getRowId: row => {
            const oid = row.order_id ?? `${row.is_buy_order ? 'B' : 'S'}-${row.type_id}-${row.region_id ?? 'r'}-${row.location_id ?? 'l'}-${row.price}`;
            return String(oid);
        },
    });

    const buyerTableWithHeaders = useReactTable({
        data: filteredBuyers,
        columns: updatedBuyerColumns,
        defaultColumn: {
            minSize: 60,
            maxSize: 600,
            size: undefined,
            enableResizing: true,
            enableColumnFilter: true,
            filterFn: excelStyleFilter,
        },
        columnResizeMode: 'onChange',
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        state: {
            sorting: tableState.buyerSorting,
            columnSizing: tableState.buyerSizing,
            columnFilters: tableState.buyerColumnFilters
        },
        enableSortingRemoval: false,
        onSortingChange: updater => setTableState(prev => ({ ...prev, buyerSorting: typeof updater === 'function' ? updater(prev.buyerSorting) : updater })),
        onColumnSizingChange: updater => setTableState(prev => ({ ...prev, buyerSizing: typeof updater === 'function' ? updater(prev.buyerSizing) : updater })),
        onColumnFiltersChange: updater => setTableState(prev => ({ ...prev, buyerColumnFilters: typeof updater === 'function' ? updater(prev.buyerColumnFilters) : updater })),
        getRowId: row => {
            const oid = row.order_id ?? `${row.is_buy_order ? 'B' : 'S'}-${row.type_id}-${row.region_id ?? 'r'}-${row.location_id ?? 'l'}-${row.price}`;
            return String(oid);
        },
    });

    // Virtualizers for updated tables
    const sellerRowVirtualizer2 = useVirtualizer({
        count: sellerTableWithHeaders.getRowModel().rows.length,
        getScrollElement: () => sellerParentRef.current,
        estimateSize: () => 24,
        overscan: 5,
        initialOffset: 0,
        getItemKey: (index) => sellerTableWithHeaders.getRowModel().rows[index]?.id ?? index,
    });

    const buyerRowVirtualizer2 = useVirtualizer({
        count: buyerTableWithHeaders.getRowModel().rows.length,
        getScrollElement: () => buyerParentRef.current,
        estimateSize: () => 24,
        overscan: 5,
        initialOffset: 0,
        getItemKey: (index) => buyerTableWithHeaders.getRowModel().rows[index]?.id ?? index,
    });

    // Final render
    return (
        <>
            {renderTable('Sellers', sellerTableWithHeaders, sellerParentRef, sellerRowVirtualizer2, 'seller')}
            {renderTable('Buyers', buyerTableWithHeaders, buyerParentRef, buyerRowVirtualizer2, 'buyer')}
        </>
    );
}