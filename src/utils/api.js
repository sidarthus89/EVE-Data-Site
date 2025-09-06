// src/utils/api.js
// Shared API module with base URLs for Azure and ESI and retry logic
import marketTree from '../data/market.json';
import regionsData from '../data/regions.json';
import structuresData from '../data/structures.json';

export const AZURE_BASE = 'https://evedatafunc01.azurewebsites.net/api';
export const ESI_BASE = 'https://esi.evetech.net/latest';

/**
 * Fetch with retry logic and exponential backoff
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ HTTP ${response.status}: ${response.statusText}`, errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            } else {
                const text = await response.text();
                console.error('❌ Non-JSON response:', text);
                throw new Error('Response is not JSON');
            }
        } catch (err) {
            console.error(`❌ Fetch attempt ${i + 1} failed:`, err.message);
            if (i === retries - 1) throw err;
            await new Promise(res => setTimeout(res, Math.pow(2, i) * 1000));
        }
    }
}


export function fetchMarketTree() {
    return Promise.resolve(marketTree);
}

export function fetchRegions() {
    // Static regions data loaded from JSON
    const data = regionsData;
    if (Array.isArray(data)) return Promise.resolve(data);
    if (Array.isArray(data.regions)) return Promise.resolve(data.regions);
    return Promise.reject(new Error('Invalid regions.json format'));
}

export function fetchStructures() {
    const data = structuresData;
    if (Array.isArray(data)) return Promise.resolve(data);
    if (Array.isArray(data.structures)) return Promise.resolve(data.structures);
    return Promise.reject(new Error('Invalid structures.json format'));
}
