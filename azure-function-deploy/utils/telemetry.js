// Simple Application Insights telemetry helper
// Reads APPINSIGHTS_INSTRUMENTATIONKEY or APPLICATIONINSIGHTS_CONNECTION_STRING from env

let appInsights;
let client;

function init() {
    try {
        // Lazy-load to avoid throwing when not installed locally
        appInsights = require('applicationinsights');
    } catch {
        return null;
    }

    if (client) return client;

    const conn = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    const ikey = process.env.APPINSIGHTS_INSTRUMENTATIONKEY;
    if (!conn && !ikey) return null;

    // Start with defaults to avoid SDK API differences
    if (conn) {
        appInsights.setup(conn).start();
    } else {
        appInsights.setup(ikey).start();
    }

    client = appInsights.defaultClient;
    return client;
}

function trackEvent(name, properties = {}, measurements = {}) {
    const c = client || init();
    if (!c) return;
    c.trackEvent({ name, properties, measurements });
}

function trackException(error, properties = {}) {
    const c = client || init();
    if (!c) return;
    c.trackException({ exception: error, properties });
}

function trackTrace(message, properties = {}) {
    const c = client || init();
    if (!c) return;
    c.trackTrace({ message, properties });
}

module.exports = { init, trackEvent, trackException, trackTrace };
