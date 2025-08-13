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
import { FiRefreshCw, FiFilter } from 'react-icons/fi';

// Utility functions
const getSecurityColor = (sec) => {
    if (sec === null || sec === undefined || sec <= 0.0) return '#8f2f69';
    if (sec >= 1.0) return '#2e74df';
    if (sec >= 0.9) return '#389cf6';
    if (sec >= 0.8) return '#4acff3';
    if (sec >= 0.7) return '#62daa6';
    if (sec >= 0.6) return '#71e452';
    if (sec >= 0.5) return '#eeff83';
    if (sec >= 0.4) return '#de6a0c';
    if (sec >= 0.3) return '#ce4611';
    if (sec >= 0.2) return '#bb1014';
    if (sec >= 0.1) return '#6d221d';
    return '#8f2f69';
};

const truncateToOneDecimal = (num) => Math.floor(num * 10) / 10;
const capitalizeWords = (str) => str?.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') ?? '';

const formatExpiresIn = (minutes) => {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    return `${days}d ${hours}h ${mins}m`;
};

const formatRange = (range) => {
    const numericRange = parseInt(range, 10);
    if (numericRange === -1) return 'Station';
    if (numericRange === 0) return 'System';
    if (numericRange === 32767) return 'Region';
    if (!isNaN(numericRange)) {
        return `${numericRange} ${numericRange === 1 ? 'Jump' : 'Jumps'}`;
    }
    const normalized = String(range).trim().toLowerCase();
    const rangeMap = { station: 'Station', system: 'System', region: 'Region' };
    return rangeMap[normalized] || capitalizeWords(String(range));
};

const formatISK = (value) => `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK`;

export default function MarketTables({ sellers, buyers, locationsData, activeTab, setActiveTab, itemName }) {
    // Consolidated filter state
    const [activeFilterColumns, setActiveFilterColumns] = useState({ seller: null, buyer: null });
    const [filterSearchTerms, setFilterSearchTerms] = useState({ seller: {}, buyer: {} });
    const filterPanelRef = useRef(null);

    // Consolidated table state
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

    // Handle outside clicks for filter panels
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterPanelRef.current && !filterPanelRef.current.contains(event.target)) {
                setActiveFilterColumns({ seller: null, buyer: null });
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Get unique values for filter dropdown
    const getColumnUniqueValues = (table, columnId) => {
        const allRows = table.getCoreRowModel().rows;
        const values = new Set();

        allRows.forEach(row => {
            let value;
            const column = table.getColumn(columnId);

            if (column?.columnDef.accessorFn) {
                value = column.columnDef.accessorFn(row.original);
            } else if (column?.columnDef.accessorKey) {
                value = row.original[column.columnDef.accessorKey];
            }

            // Format the value for display
            if (columnId === 'security') {
                const sec = truncateToOneDecimal(value ?? 0);
                values.add(sec >= 0 ? `${sec.toFixed(1)}` : `${sec.toFixed(1)}`);
            } else if (columnId === 'location_name') {
                const stationName = stationInfoMap[value]?.name;
                if (stationName) values.add(capitalizeWords(stationName));
            } else if (columnId === 'region_name') {
                const regionName = stationInfoMap[value]?.region;
                if (regionName) values.add(capitalizeWords(regionName));
            }
        });

        return Array.from(values).sort();
    };

    // Custom filter function for Excel-style filtering
    const excelStyleFilter = (row, columnId, filterValue) => {
        if (!filterValue || filterValue.length === 0) return true;

        let cellValue;
        const column = row.table.getColumn(columnId);

        if (column?.columnDef.accessorFn) {
            cellValue = column.columnDef.accessorFn(row.original);
        } else if (column?.columnDef.accessorKey) {
            cellValue = row.original[column.columnDef.accessorKey];
        }

        // Format cell value to match display format
        if (columnId === 'security') {
            const sec = truncateToOneDecimal(cellValue ?? 0);
            cellValue = sec >= 0 ? `${sec.toFixed(1)}` : `${sec.toFixed(1)}`;
        } else if (columnId === 'location_name') {
            cellValue = capitalizeWords(stationInfoMap[cellValue]?.name || '');
        } else if (columnId === 'region_name') {
            cellValue = capitalizeWords(stationInfoMap[cellValue]?.region || '');
        }

        return filterValue.includes(String(cellValue));
    };
    const stationInfoMap = useMemo(() => {
        if (!locationsData) return {};
        const map = {};
        Object.entries(locationsData).forEach(([regionName, region]) => {
            Object.values(region).forEach(constellation => {
                Object.values(constellation).forEach(system => {
                    const security = truncateToOneDecimal(system.security ?? null);
                    if (system.stations) {
                        Object.entries(system.stations).forEach(([id, station]) => {
                            map[parseInt(id)] = {
                                name: station.stationName,
                                security: station.security ?? security ?? null,
                                region: regionName,
                            };
                        });
                    }
                });
            });
        });
        return map;
    }, [locationsData]);

    // Shared column factories
    const createSecurityColumn = (tableType) => ({
        accessorFn: row => stationInfoMap[row.location_id]?.security ?? -1,
        id: 'security',
        header: 'Sec.',
        Header: ({ column }) => renderHeaderWithFilter('Sec.', column, tableType),
        cell: info => {
            const rawSec = stationInfoMap[info.row.original.location_id]?.security;
            const sec = truncateToOneDecimal(rawSec ?? 0);
            return (
                <span className="sec-cell" style={{ color: getSecurityColor(sec) }}>
                    {sec >= 0 ? `\u00A0${sec.toFixed(1)}` : sec.toFixed(1)}
                </span>
            );
        },
        size: 48,
    });

    const createLocationColumn = (tableType) => {
        const getSharedSortKey = (locationID) => {
            const station = stationInfoMap[locationID];
            if (!station) return 'zzz';
            const sec = station.security == null ? 999 : truncateToOneDecimal(station.security);
            return `${sec}-${station.name || ''}`.toLowerCase();
        };

        return {
            accessorKey: 'location_id',
            id: 'location_name',
            header: 'Location',
            Header: ({ column }) => renderHeaderWithFilter('Location', column, tableType),
            cell: info => capitalizeWords(stationInfoMap[info.getValue()]?.name || 'Loading...'),
            sortingFn: (a, b) => {
                const keyA = getSharedSortKey(a.original.location_id);
                const keyB = getSharedSortKey(b.original.location_id);
                return keyA.localeCompare(keyB);
            },
            size: 320,
        };
    };

    const createRegionColumn = (tableType) => ({
        accessorKey: 'location_id',
        id: 'region_name',
        header: 'Region',
        Header: ({ column }) => renderHeaderWithFilter('Region', column, tableType),
        cell: info => capitalizeWords(stationInfoMap[info.getValue()]?.region || 'Loading...'),
        sortingFn: (a, b) => {
            const regionA = stationInfoMap[a.original.location_id]?.region || '';
            const regionB = stationInfoMap[b.original.location_id]?.region || '';
            return regionA.localeCompare(regionB);
        },
        size: 160,
    });

    const createExpiresColumn = (tableType) => ({
        accessorKey: 'duration',
        header: 'Expires in',
        Header: ({ column }) => renderHeaderWithFilter('Expires in', column, tableType),
        cell: info => {
            const { issued, duration } = info.row.original;
            const issuedDate = new Date(issued);
            const expiryDate = new Date(issuedDate.getTime() + duration * 24 * 60 * 60 * 1000);
            const now = new Date();
            const diffMinutes = Math.max(Math.floor((expiryDate - now) / 60000), 0);
            return formatExpiresIn(diffMinutes);
        },
        size: 128,
    });

    const renderHeaderWithFilter = (label, column, tableType) => (
        <>
            <span className="header-text">{label}</span>
            <button
                className="header-filter-btn"
                onClick={(e) => {
                    e.stopPropagation();
                    setActiveFilterColumns(prev => ({ ...prev, [tableType]: column.id }));
                }}
            >
                <FiFilter />
            </button>
        </>
    );

    // Column definitions
    const sellerColumns = useMemo(() => [
        {
            accessorKey: 'volume_remain',
            header: 'Quantity',
            Header: ({ column }) => renderHeaderWithFilter('Quantity', column, 'seller'),
            size: 96,
        },
        {
            accessorKey: 'price',
            header: 'Price',
            Header: ({ column }) => renderHeaderWithFilter('Price', column, 'seller'),
            cell: info => formatISK(info.getValue()),
            size: 160,
        },
        createSecurityColumn('seller'),
        createLocationColumn('seller'),
        createRegionColumn('seller'),
        createExpiresColumn('seller'),
    ], [stationInfoMap]);

    const buyerColumns = useMemo(() => [
        {
            accessorKey: 'min_volume',
            header: 'Min Volume',
            Header: ({ column }) => renderHeaderWithFilter('Min Volume', column, 'buyer'),
            cell: info => info.getValue().toLocaleString(),
            size: 80,
        },
        {
            accessorKey: 'volume_remain',
            header: 'Quantity',
            Header: ({ column }) => renderHeaderWithFilter('Quantity', column, 'buyer'),
            size: 96,
        },
        {
            accessorKey: 'price',
            header: 'Price',
            Header: ({ column }) => renderHeaderWithFilter('Price', column, 'buyer'),
            cell: info => formatISK(info.getValue()),
            size: 160,
        },
        createSecurityColumn('buyer'),
        createLocationColumn('buyer'),
        createRegionColumn('buyer'),
        {
            accessorKey: 'range',
            header: 'Range',
            Header: ({ column }) => renderHeaderWithFilter('Range', column, 'buyer'),
            cell: info => formatRange(info.getValue()),
            size: 64,
        },
        createExpiresColumn('buyer'),
    ], [stationInfoMap]);

    const defaultColumn = useMemo(() => ({
        minSize: 60,
        maxSize: 600,
        size: undefined,
        enableResizing: true,
        enableColumnFilter: true,
        filterFn: excelStyleFilter,
    }), [stationInfoMap]);

    // Create tables
    const createTable = (data, columns, sortKey, sizingKey, filtersKey) => {
        const updateState = (updater, key) => {
            setTableState(prev => ({ ...prev, [key]: typeof updater === 'function' ? updater(prev[key]) : updater }));
        };

        return useReactTable({
            data,
            columns,
            defaultColumn,
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
            onSortingChange: updater => updateState(updater, sortKey),
            onColumnSizingChange: updater => updateState(updater, sizingKey),
            onColumnFiltersChange: updater => updateState(updater, filtersKey),
            getRowId: row => row.order_id.toString(),
        });
    };

    const sellerTable = createTable(sellers, sellerColumns, 'sellerSorting', 'sellerSizing', 'sellerColumnFilters');
    const buyerTable = createTable(buyers, buyerColumns, 'buyerSorting', 'buyerSizing', 'buyerColumnFilters');

    const createVirtualizer = (table, parentRef) => useVirtualizer({
        count: table.getRowModel().rows.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 24,
        overscan: 10,
    });

    const sellerRowVirtualizer = createVirtualizer(sellerTable, sellerParentRef);
    const buyerRowVirtualizer = createVirtualizer(buyerTable, buyerParentRef);

    // Render table function
    const renderTable = (title, table, parentRef, rowVirtualizer, tableType) => (
        <div className="market-table-wrapper">
            <h3 className="market-table-title">
                {title} ({table.getRowModel().rows.length} orders)
            </h3>
            <div className="market-table">
                <div className="thead">
                    {table.getHeaderGroups().map(headerGroup => (
                        <div key={headerGroup.id} className="thead-row">
                            {headerGroup.headers.map(header => {
                                const canFilter = ['security', 'region_name', 'location_name'].includes(header.column.id);
                                const isActiveFilter = activeFilterColumns[tableType] === header.column.id;

                                return (
                                    <div key={header.id} className="column-header-wrapper">
                                        <div className="column-header" style={{ width: header.getSize() }}>
                                            <span onClick={header.column.getToggleSortingHandler()}>
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted()] ?? ''}
                                            </span>
                                            {header.column.getCanResize() && (
                                                <div
                                                    onMouseDown={header.getResizeHandler()}
                                                    onTouchStart={header.getResizeHandler()}
                                                    className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
                                                />
                                            )}
                                        </div>

                                        {canFilter && (
                                            <div className="column-filter-button-wrapper" style={{ width: header.getSize(), marginTop: 4, position: 'relative' }}>
                                                <button
                                                    className="filter-button"
                                                    onClick={() => setActiveFilterColumns(prev => ({
                                                        ...prev,
                                                        [tableType]: isActiveFilter ? null : header.column.id
                                                    }))}
                                                    title="Filter column"
                                                >
                                                    <FiFilter />
                                                </button>

                                                {isActiveFilter && (
                                                    <div className="filter-panel" ref={filterPanelRef}>
                                                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #ccc', backgroundColor: 'white' }}>
                                                            <div style={{ padding: '8px', borderBottom: '1px solid #eee' }}>
                                                                <input
                                                                    type="text"
                                                                    placeholder="Search..."
                                                                    value={filterSearchTerms[tableType]?.[header.column.id] || ''}
                                                                    onChange={e => {
                                                                        const term = e.target.value;
                                                                        setFilterSearchTerms(prev => ({
                                                                            ...prev,
                                                                            [tableType]: {
                                                                                ...prev[tableType],
                                                                                [header.column.id]: term
                                                                            }
                                                                        }));
                                                                    }}
                                                                    style={{ width: '100%', padding: '4px' }}
                                                                />
                                                            </div>

                                                            <div style={{ padding: '4px' }}>
                                                                <label style={{ display: 'block', padding: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={!header.column.getFilterValue() || header.column.getFilterValue().length === 0}
                                                                        onChange={(e) => {
                                                                            if (e.target.checked) {
                                                                                header.column.setFilterValue([]);
                                                                            } else {
                                                                                const allValues = getColumnUniqueValues(table, header.column.id);
                                                                                header.column.setFilterValue(allValues);
                                                                            }
                                                                        }}
                                                                        style={{ marginRight: '6px' }}
                                                                    />
                                                                    (Select All)
                                                                </label>

                                                                {getColumnUniqueValues(table, header.column.id)
                                                                    .filter(value => {
                                                                        const searchTerm = filterSearchTerms[tableType]?.[header.column.id] || '';
                                                                        return !searchTerm || value.toLowerCase().includes(searchTerm.toLowerCase());
                                                                    })
                                                                    .map(value => {
                                                                        const currentFilter = header.column.getFilterValue() || [];
                                                                        const isChecked = currentFilter.length === 0 || currentFilter.includes(value);

                                                                        return (
                                                                            <label key={value} style={{ display: 'block', padding: '2px 4px', cursor: 'pointer' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isChecked}
                                                                                    onChange={(e) => {
                                                                                        const currentFilter = header.column.getFilterValue() || [];
                                                                                        let newFilter;

                                                                                        if (e.target.checked) {
                                                                                            // Add to filter
                                                                                            newFilter = currentFilter.length === 0 ?
                                                                                                [value] :
                                                                                                [...currentFilter, value];
                                                                                        } else {
                                                                                            // Remove from filter
                                                                                            if (currentFilter.length === 0) {
                                                                                                // If "Select All" was active, start with all values except this one
                                                                                                const allValues = getColumnUniqueValues(table, header.column.id);
                                                                                                newFilter = allValues.filter(v => v !== value);
                                                                                            } else {
                                                                                                newFilter = currentFilter.filter(v => v !== value);
                                                                                            }
                                                                                        }

                                                                                        header.column.setFilterValue(newFilter.length === getColumnUniqueValues(table, header.column.id).length ? [] : newFilter);
                                                                                    }}
                                                                                    style={{ marginRight: '6px' }}
                                                                                />
                                                                                <span style={header.column.id === 'security' ? { color: getSecurityColor(parseFloat(value)) } : {}}>
                                                                                    {value}
                                                                                </span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                            </div>

                                                            <div style={{ padding: '8px', borderTop: '1px solid #eee', display: 'flex', gap: '8px' }}>
                                                                <button
                                                                    onClick={() => {
                                                                        header.column.setFilterValue([]);
                                                                        setFilterSearchTerms(prev => ({
                                                                            ...prev,
                                                                            [tableType]: {
                                                                                ...prev[tableType],
                                                                                [header.column.id]: ''
                                                                            }
                                                                        }));
                                                                    }}
                                                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                                                >
                                                                    Clear
                                                                </button>
                                                                <button
                                                                    onClick={() => setActiveFilterColumns(prev => ({ ...prev, [tableType]: null }))}
                                                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                                                >
                                                                    Close
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
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

    return (
        <>
            {renderTable('Sellers', sellerTable, sellerParentRef, sellerRowVirtualizer, 'seller')}
            {renderTable('Buyers', buyerTable, buyerParentRef, buyerRowVirtualizer, 'buyer')}
        </>
    );
}