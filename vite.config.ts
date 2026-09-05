import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
