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
                // Split big shared libraries into their own cached vendor chunks so they
                // aren't duplicated across page chunks and are reused across navigations.
                // NOTE: do NOT split d3-hierarchy/shape/zoom into a separate chunk — they
                // share transitive d3 modules (internmap via d3-scale) with recharts and
                // react-force-graph, and a separate d3 chunk creates a cross-chunk circular
                // init ("Cannot access 'InternMap' before initialization") that blanks the
                // whole app in the production build. Let Rollup co-locate them instead.
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-charts': ['recharts'],
                    'vendor-graph': ['react-force-graph-2d', 'd3-force'],
                    'vendor-editor': ['@tiptap/react', '@tiptap/starter-kit',
                        '@tiptap/extension-text-align', '@tiptap/extension-underline'],
                    'vendor-export': ['jspdf', 'html2canvas', 'html-to-image', 'xlsx'],
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
