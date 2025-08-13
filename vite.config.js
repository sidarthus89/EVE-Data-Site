//vite.config.js

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoName = 'EVE-Data-Site';

export default defineConfig(({ mode }) => {
  const IS_DEV = mode !== 'production';

  return {
    optimizeDeps: {
      include: ['recharts']
    },

    base: IS_DEV ? '/' : `/${repoName}/`,
    plugins: [react()],
    define: {
      'import.meta.env.IS_DEV': JSON.stringify(IS_DEV)
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
          secure: false
        }
      }
    }
  };
});