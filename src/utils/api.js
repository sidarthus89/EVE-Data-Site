// src/utils/api.js
// Shared API module with base URLs for Azure and ESI and retry logic
import marketTree from '../data/market.json';

const AZURE_BASE = 'https://evetradefunc01-hycngkbxfycke8cf.eastus2-01.azurewebsites.net/api';
const ESI_BASE = 'https://esi.evetech.net/latest';

/**
 * Fetch with retry logic and exponential backoff
 */
export async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`🌐 Fetching: ${url} (attempt ${i + 1}/${retries})`);
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

export { AZURE_BASE, ESI_BASE };

export function fetchMarketTree() {
    return Promise.resolve(marketTree);
}

export async function fetchRegions() {
    const response = await fetch('/data/regions.json');
    if (!response.ok) throw new Error('Failed to fetch regions.json');
    const data = await response.json();

    // Accept either raw array or wrapped format
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.regions)) return data.regions;

    throw new Error('Invalid regions.json format');
}
