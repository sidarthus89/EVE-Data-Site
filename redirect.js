// redirect.js
// Copies public/404.html to dist/404.html and rewrites the repoName for GH Pages SPA redirect.
import { readFile, writeFile } from 'fs/promises';
import { mkdirSync } from 'fs';

const mode = (process.argv[2] || '').toLowerCase();
const repoName = mode === 'dev' ? 'EVE-Data-Site-Dev' : 'EVE-Data-Site';

try {
    const src = await readFile('public/404.html', 'utf-8');
    // No need to rewrite static repo name now, but keep compatibility if placeholder exists
    const rewritten = src.replace(
        /var\s+repoName\s*=\s*"[^"]+"\s*;/,
        `var repoName = "${repoName}";`
    );
    // Ensure dist exists (should already via build)
    try { mkdirSync('dist', { recursive: true }); } catch { }
    await writeFile('dist/404.html', rewritten, 'utf-8');

    // Also write a version.txt with a timestamp to bust caches on clients
    const stamp = new Date().toISOString();
    await writeFile('dist/version.txt', stamp, 'utf-8');
    console.log(`✅ 404.html written for repo ${repoName}`);
    console.log(`✅ version.txt updated: ${stamp}`);
} catch (err) {
    console.error('❌ Failed to write 404.html:', err);
}
