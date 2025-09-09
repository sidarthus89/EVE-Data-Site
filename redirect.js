// redirect.js
// Copies public/404.html to dist/404.html and rewrites the repoName for GH Pages SPA redirect.
import { readFile, writeFile } from 'fs/promises';

const mode = (process.argv[2] || '').toLowerCase();
const repoName = mode === 'dev' ? 'EVE-Data-Site-Dev' : 'EVE-Data-Site';

try {
    const src = await readFile('public/404.html', 'utf-8');
    // No need to rewrite static repo name now, but keep compatibility if placeholder exists
    const rewritten = src.replace(
        /var\s+repoName\s*=\s*"[^"]+"\s*;/,
        `var repoName = "${repoName}";`
    );
    await writeFile('dist/404.html', rewritten, 'utf-8');
    console.log(`✅ 404.html written for repo ${repoName}`);
} catch (err) {
    console.error('❌ Failed to write 404.html:', err);
}
