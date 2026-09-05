interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'No se pudieron obtener los datos', message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-bear-500/40 bg-bear-500/5 p-5 text-sm text-mist-200"
    >
      <h3 className="mb-1 font-semibold text-bear-400">{title}</h3>
      <p className="text-mist-400">{message}</p>
      <p className="mt-2 text-xs text-mist-400">
        La API pública de CoinGecko limita las peticiones por minuto. Si el error persiste, espera
        unos segundos antes de reintentar.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry()}
          className="mt-4 rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-medium text-mist-200 transition hover:border-accent-400 hover:text-white"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
