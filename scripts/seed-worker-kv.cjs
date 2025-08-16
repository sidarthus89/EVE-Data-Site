// scripts/seed-worker-kv.cjs
// Copies market.json and locations.json from public/data to worker-api/data, seeds the worker, then removes the copies from worker-api/data

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const srcDir = path.join(__dirname, '../public/data');
const destDir = path.join(__dirname, '../worker-api/data');
const files = ['market.json', 'locations.json'];

function copyFiles() {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    files.forEach(file => {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(`Copied ${file}`);
        }
    });
}

function removeFiles() {
    files.forEach(file => {
        const dest = path.join(destDir, file);
        if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
            console.log(`Removed ${file}`);
        }
    });
}

function seedWorker() {
    // You may need to adjust this command to match your seeding setup
    try {
        execSync('npm run worker:seed', { stdio: 'inherit' });
    } catch (e) {
        console.error('Seeding failed:', e.message);
        process.exit(1);
    }
}

copyFiles();
seedWorker();
removeFiles();
console.log('Worker KV seeded successfully.');
