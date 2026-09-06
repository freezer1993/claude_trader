import { Navigate, Route, Routes } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { CoinProvider } from './context/CoinContext';
import { ToastProvider } from './context/ToastContext';
import { ToastViewport } from './components/ToastViewport';
import { CoinDetail } from './pages/CoinDetail';
import { Dashboard } from './pages/Dashboard';

export default function App() {
  return (
    <ToastProvider>
      <CoinProvider>
      <div className="min-h-dvh bg-ink-950">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-ink-800 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
        >
          Saltar al contenido
        </a>
        <Navbar />
        <main id="contenido" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/coin/:coinId" element={<CoinDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 text-[11px] text-mist-400 sm:px-6">
          Datos de mercado por CoinGecko (API pública). Análisis técnico calculado en el cliente.
          Contenido informativo, no asesoramiento financiero.
        </footer>
      </div>
      </CoinProvider>
      <ToastViewport />
    </ToastProvider>
  );
}
