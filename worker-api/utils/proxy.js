// worker-api/utils/proxy.js

export async function proxyToESI(url) {
    const esiUrl = `https://esi.evetech.net/latest${url.pathname}?${url.searchParams.toString()}`;

    try {
        const esiResponse = await fetch(esiUrl);

        // Read the full body to safely clone it
        const body = await esiResponse.text();

        const headers = new Headers(esiResponse.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
        headers.set('Access-Control-Allow-Methods', 'GET');
        headers.set('Content-Type', 'application/json'); // Ensure consistent type

        return new Response(body, {
            status: esiResponse.status,
            headers,
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: 'ESI fetch failed', detail: err.message }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
}