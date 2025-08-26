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

    base: IS_DEV ? '/' : `/${repoName}/`,
    plugins: [react()],
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