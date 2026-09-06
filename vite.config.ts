import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import { hostname, networkInterfaces } from 'node:os';

const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:3001';

/**
 * Acceso desde otros equipos de la red local. Se activa con `npm run dev:lan`
 * o pasando `--host`, que es lo primero que se suele probar; reconocer ambos
 * evita que `vite --host` sirva la página pero deje la recarga en caliente
 * rota por la comprobación de host.
 */
const LAN = process.env.CT_LAN === '1' || process.argv.includes('--host');

/**
 * Nombres y direcciones propias que se autorizan en la comprobación de host de
 * Vite. Las IPv4 no la necesitan, pero el nombre de la máquina sí: entrar desde
 * el móvil a `http://mi-mac.local:5173` (Bonjour) es más cómodo que teclear una
 * IP, y sin esta lista Vite devuelve 403.
 *
 * Se enumeran los nombres reales en lugar de poner `allowedHosts: true`, que
 * desactivaría la comprobación por completo y abriría la puerta a ataques de
 * reenlace de DNS.
 */
function localHostNames(): string[] {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface!.address);

  const name = hostname().toLowerCase();
  const bonjour = name.endsWith('.local') ? name : `${name}.local`;

  return [...new Set(['localhost', name, bonjour, ...addresses])];
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // El cliente llama a rutas relativas (/api/...) y Vite las reenvía al API en
  // desarrollo: así no hay CORS que configurar ni URLs absolutas en el código.
  // En red local el móvil habla solo con Vite; el API sigue en localhost y no
  // necesita exponerse.
  server: {
    ...(LAN ? { host: true, allowedHosts: localHostNames() } : {}),
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
