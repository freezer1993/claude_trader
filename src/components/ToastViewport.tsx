import { useToast, type ToastTone } from '../context/ToastContext';

const TONE_STYLES: Record<ToastTone, { border: string; icon: string; title: string }> = {
  success: { border: 'border-bull-500/50 bg-bull-500/10', icon: '✓', title: 'text-bull-400' },
  error: { border: 'border-bear-500/50 bg-bear-500/10', icon: '✕', title: 'text-bear-400' },
  info: { border: 'border-accent-400/50 bg-accent-400/10', icon: 'i', title: 'text-accent-400' },
};

export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      // aria-live en el contenedor y no en cada aviso: el lector de pantalla
      // debe estar observando la región antes de que llegue el mensaje.
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {toasts.map((toast) => {
        const style = TONE_STYLES[toast.tone];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto w-full max-w-sm rounded-xl border p-3 shadow-lg backdrop-blur ${style.border}`}
          >
            <div className="flex items-start gap-2.5">
              <span aria-hidden="true" className={`text-sm font-bold ${style.title}`}>
                {style.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${style.title}`}>{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs break-words text-mist-200">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Descartar aviso"
                className="rounded px-1 text-mist-400 transition hover:text-white"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
