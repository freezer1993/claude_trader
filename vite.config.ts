import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // El cliente llama a rutas relativas (/api/...) y Vite las reenvía al API en
  // desarrollo: así no hay CORS que configurar ni URLs absolutas en el código.
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    // lightweight-charts is heavy; keep it in its own chunk so the dashboard
    // shell (table + analysis) can paint before the charting engine arrives.
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes('node_modules/lightweight-charts') ? 'charts' : undefined,
      },
    },
  },
});
