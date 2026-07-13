import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
    plugins: [react()],
    // Strip console.* and debugger statements from the production bundle only
    // (command === 'build'); dev keeps logging intact for debugging.
    esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
    build: {
        rollupOptions: {
            output: {
                // Keep ONLY react/router in a stable shared vendor chunk. Everything else
                // (recharts, tiptap, force-graph, d3, jspdf, xlsx, html-to-image) is reached
                // through lazy routes / dynamic import()s, so Rollup already splits it into
                // async chunks that load on demand.
                //
                // Do NOT hand-group those heavy libs into manualChunks: it has twice caused
                // production-only breakage — (1) a d3 chunk created a cross-chunk circular
                // init ("Cannot access 'InternMap' before initialization") that blanked the
                // whole app, and (2) the vendor-export chunk trapped Vite's __vitePreload
                // helper, forcing the entry to eagerly modulepreload ~1MB of export libs.
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                },
            },
        },
    },
    server: {
        port: 5173,
        host: true, // Listen on all addresses
        allowedHosts: ['.ngrok-free.dev', '.ngrok.io'], // Allow ngrok domains
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
            '/auth': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },
}))
