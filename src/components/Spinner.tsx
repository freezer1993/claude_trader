export function Spinner({ label = 'Cargando datos…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-mist-400" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-ink-600 border-t-accent-400"
      />
      <span>{label}</span>
    </div>
  );
}

/** Bloque de carga con la altura del contenido final, para evitar saltos de layout. */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-ink-800 ${className}`} aria-hidden="true" />;
}
