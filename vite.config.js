//vite.config.js

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// ...existing code...

const PROD_REPO = 'EVE-Data-Site';
const DEV_REPO = 'EVE-Data-Site-Dev';

export default defineConfig(({ mode, command }) => {
  const IS_DEV = mode !== 'production';

  return {
    optimizeDeps: {
      include: ['recharts']
    },
    build: {
      target: 'esnext',
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: !IS_DEV,
          drop_debugger: !IS_DEV
        }
      },
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'chart-vendor': ['recharts'],
            'icons': ['react-icons']
          }
        }
      },
    },

    // Base path logic:
    // - Local dev server: '/'
    // - Dev build (mode === 'development' with publish:dev): '/EVE-Data-Site-Dev/'
    // - Prod build: '/EVE-Data-Site/'
    base: command === 'serve'
      ? '/'
      : (mode === 'development' ? `/${DEV_REPO}/` : `/${PROD_REPO}/`),
    plugins: [
      react(),
    ],
    define: {
      'import.meta.env.IS_DEV': JSON.stringify(IS_DEV)
    },
    resolve: {
      alias: {
        '@worker': '/worker-api',
      },
    }
  };
});