// src/utils/api.js
// Shared API module with base URLs for Azure and ESI and retry logic
import marketTree from '../data/market.json';

const AZURE_BASE = 'https://evetradefunc01-hycngkbxfycke8cf.eastus2-01.azurewebsites.net/api';
const ESI_BASE = 'https://esi.evetech.net/latest';

/**
 * Fetch with retry logic and exponential backoff
 */
export const fetchWithRetry = async (url, options = {}, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Parse JSON once here
            const data = await response.json();
            return data; // This will be a JavaScript object

        } catch (error) {
            if (i === maxRetries - 1) {
                throw error;
            }
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
};

export { AZURE_BASE, ESI_BASE };

export function fetchMarketTree() {
    return Promise.resolve(marketTree);
}

export async function fetchRegions() {
    // Use Vite base URL so GitHub Pages serves from correct path
    const url = `${import.meta.env.BASE_URL}data/regions.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch regions.json');
    const data = await response.json();

    // Accept either raw array or wrapped format
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.regions)) return data.regions;

    throw new Error('Invalid regions.json format');
}
