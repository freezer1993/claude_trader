import { useCoins } from '../context/CoinContext';

/**
 * Indica dónde se están guardando las tenencias. Es información necesaria, no
 * decorativa: en modo local no hay histórico ni sincronización, y el usuario
 * debe saberlo antes de introducir saldos reales.
 */
export function PersistenceBadge() {
  const { persistenceMode, persistenceError, lastRunId } = useCoins();

  if (persistenceMode === 'loading') {
    return <span className="text-[11px] text-mist-400">Conectando…</span>;
  }

  if (persistenceMode === 'api') {
    return (
      <span
        title={
          lastRunId
            ? `Último análisis archivado con el identificador #${lastRunId}.`
            : 'Conectado a la base de datos.'
        }
        className="rounded border border-bull-500/40 bg-bull-500/10 px-2 py-0.5 text-[10px] font-bold text-bull-400"
      >
        BASE DE DATOS
      </span>
    );
  }

  return (
    <span
      title={persistenceError ?? 'Sin conexión con el servidor.'}
      className="rounded border border-warn-400/40 bg-warn-400/10 px-2 py-0.5 text-[10px] font-bold text-warn-400"
    >
      SOLO ESTE NAVEGADOR
    </span>
  );
}
