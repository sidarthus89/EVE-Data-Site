/* Trigger structures_sync locally via HTTP */
const fetch = require('node-fetch');

(async () => {
    const baseRaw = process.env.STRUCTURES_SYNC_URL || 'http://localhost:7071';
    const base = String(baseRaw).trim();

    let url;
    try {
        const u = new URL(base);
        u.pathname = `${(u.pathname || '').replace(/\/$/, '')}/api/structures/sync`;
        url = u;
    } catch (e) {
        console.error('Invalid STRUCTURES_SYNC_URL:', baseRaw);
        process.exit(1);
    }

    const key = process.env.STRUCTURES_SYNC_KEY || process.env.FUNCTIONS_SYNC_KEY || process.env.FUNCTION_KEY;
    const headers = { 'User-Agent': 'EVE-Data-Site/trigger-script' };
    if (key) {
        url.searchParams.set('code', key);
        headers['x-functions-key'] = key;
    }
    const method = process.env.STRUCTURES_SYNC_METHOD || 'POST';
    console.log(`Calling ${url.toString()} [${method}] ...`);
    try {
        const res = await fetch(url.toString(), { method, headers });
        const text = await res.text();
        console.log(`Status: ${res.status} ${res.statusText}`);
        try {
            const json = JSON.parse(text);
            console.log('Response JSON:', JSON.stringify(json, null, 2));
        } catch {
            console.log('Response:', text);
        }
        if (!res.ok) process.exit(1);
    } catch (err) {
        console.error('Request failed:', err.message || err);
        console.error('Hint: Is the Functions host running on', base, '?');
        console.error('      If authLevel=function, set STRUCTURES_SYNC_KEY to your function key.');
        process.exit(1);
    }
})();
