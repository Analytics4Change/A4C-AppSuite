import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import checker from 'vite-plugin-checker';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  
  return {
    plugins: [
      react(),
      checker({
        typescript: true,
        eslint: {
          lintCommand: 'eslint "./src/**/*.{ts,tsx}"',
          dev: {
            logLevel: ['error'],
          },
        },
        overlay: {
          initialIsOpen: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    server: {
      port: 3000,
      open: true
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Optimize for production
      minify: isProduction ? 'esbuild' : false,
      // Remove console.log and debugger statements in production
      esbuild: isProduction ? {
        drop: ['console', 'debugger'],
        pure: ['console.log', 'console.debug', 'console.warn']
      } : undefined,
      rollupOptions: {
        output: {
          // Tree-shake unused logger code in production
          manualChunks: (id) => {
            // Put logger in separate chunk for better tree-shaking
            if (id.includes('utils/logger')) {
              return 'logger';
            }
          }
        }
      }
    },
    define: {
      // Define compile-time constants for dead code elimination
      '__DEV__': JSON.stringify(!isProduction),
      '__PROD__': JSON.stringify(isProduction),
      '__LOG_ENABLED__': JSON.stringify(!isProduction)
    }
  };
});