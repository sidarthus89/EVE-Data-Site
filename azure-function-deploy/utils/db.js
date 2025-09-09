// Centralized DB configuration resolver for MSSQL
// Prefers a full connection string via DB_CONNECTION_STRING or Azure's SQLCONNSTR_* conventions

function getDbConfig() {
    // 1) Direct app setting override
    if (process.env.DB_CONNECTION_STRING) {
        return process.env.DB_CONNECTION_STRING;
    }

    // 2) Azure Connection Strings are exposed as env vars with prefixes
    //    SQLAZURECONNSTR_* (SQL Azure) and SQLCONNSTR_* (SQL Server)
    const candidates = [];
    for (const [key, value] of Object.entries(process.env)) {
        if ((key.startsWith('SQLAZURECONNSTR_') || key.startsWith('SQLCONNSTR_')) && value) {
            const name = key.replace(/^SQLAZURECONNSTR_|^SQLCONNSTR_/i, '');
            candidates.push({ key, name, value });
        }
    }
    if (candidates.length > 0) {
        // Prefer common names if present
        const preferredOrder = ['EveData', 'EveDataDB', 'DefaultConnection'];
        const preferred = preferredOrder.map(n => candidates.find(c => c.name.toLowerCase() === n.toLowerCase())).find(Boolean);
        return (preferred ? preferred.value : candidates[0].value);
    }

    // 3) Fallback to discrete variables
    const { DB_USER, DB_PASSWORD, DB_NAME, DB_SERVER } = process.env;
    if (DB_SERVER && DB_NAME) {
        return {
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            server: DB_SERVER,
            options: { encrypt: true }
        };
    }

    // Return null; callers should handle missing config and emit clear diagnostics
    return null;
}

module.exports = { getDbConfig };
