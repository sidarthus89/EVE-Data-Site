// src/utils/utils.js
export const truncateToOneDecimal = num => Math.floor(num * 10) / 10;

export const capitalizeWords = str =>
    str?.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') ?? '';

export const formatISK = val =>
    `${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK`;

export const formatExpiresIn = mins => {
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return `${d}d ${h}h ${m}m`;
};

export const formatRange = range => {
    const r = parseInt(range, 10);
    if (r === -1) return 'Station';
    if (r === 0) return 'System';
    if (r === 32767) return 'Region';
    if (!isNaN(r)) return `${r} ${r === 1 ? 'Jump' : 'Jumps'}`;
    const norm = String(range).trim().toLowerCase();
    return ['station', 'system', 'region'].includes(norm) ? capitalizeWords(norm) : capitalizeWords(range);
};

export const getSecurityColor = sec => {
    const thresholds = [
        [1.0, '#2e74df'], [0.9, '#389cf6'], [0.8, '#4acff3'], [0.7, '#62daa6'],
        [0.6, '#71e452'], [0.5, '#eeff83'], [0.4, '#de6a0c'], [0.3, '#ce4611'],
        [0.2, '#bb1014'], [0.1, '#6d221d'], [0.0, '#8f2f69']
    ];
    for (const [threshold, color] of thresholds) if (sec >= threshold) return color;
    return '#8f2f69';
};