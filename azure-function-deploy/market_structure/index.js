// Azure Function: GetMarketStructure
// Place this in your Azure Functions project
// azure-function-deploy/market_structure/index.js

const fs = require('fs');
const path = require('path');

module.exports = async function (context, req) {
    context.log('Market structure endpoint called');

    try {
        // Adjust this path based on where you place market.json in your Azure Functions project
        const filePath = path.join(__dirname, '../data/market.json');

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            context.log.error('market.json file not found at:', filePath);
            context.res = {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
                body: { error: 'Market structure file not found' }
            };
            return;
        }

        // Read and return the market structure
        const data = fs.readFileSync(filePath, 'utf8');
        const marketData = JSON.parse(data);

        context.log('Market structure loaded successfully, categories:', Object.keys(marketData).length);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: marketData
        };
    } catch (err) {
        context.log.error('Error reading market.json:', err);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: { error: 'Could not read market structure', details: err.message }
        };
    }
};
