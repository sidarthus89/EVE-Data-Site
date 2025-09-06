// redirect.js
import { copyFile } from 'fs/promises';

try {
    await copyFile('dist/index.html', 'dist/404.html');
    console.log('✅ 404.html copied successfully');
} catch (err) {
    console.error('❌ Failed to copy 404.html:', err);
}
