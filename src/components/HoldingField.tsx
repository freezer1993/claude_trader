import { useId, useState } from 'react';
import { symbolOf, useCoins } from '../context/CoinContext';
import { useToast } from '../context/ToastContext';
import { formatNumber, formatPrice } from '../lib/format';
import { isValidAmountInput, parseAmount, STABLE_ID, type AssetId } from '../lib/portfolio';
import { ConfirmDialog } from './ConfirmDialog';

interface HoldingFieldProps {
  assetId: AssetId;
  /** Precio unitario para mostrar el valor equivalente en el diálogo. */
  priceUsd?: number | null;
  className?: string;
}

/**
 * Campo de cantidad con guardado explícito. El valor escrito es un borrador:
 * el análisis sigue usando el saldo confirmado hasta que el usuario pulsa
 * guardar y acepta el diálogo. Sin esa separación, cada pulsación de tecla
 * generaría un movimiento en el histórico.
 */
export function HoldingField({ assetId, priceUsd, className = '' }: HoldingFieldProps) {
  const { drafts, holdings, setDraft, resetDraft, isDirty, saveHolding, savingAsset, persistenceMode } =
    useCoins();
  /*
   * Identificador por instancia, no derivado del activo: el mismo activo se
   * renderiza dos veces en el panel (la tabla de escritorio y la tarjeta de
   * móvil conviven en el DOM, ocultas por CSS). Un id fijo produciría
   * duplicados, que son HTML inválido y hacen que el label apunte al campo
   * equivocado para un lector de pantalla.
   */
  const inputId = useId();
  const { push } = useToast();
  const [confirming, setConfirming] = useState(false);

  const symbol = symbolOf(assetId);
  const draft = drafts[assetId] ?? '';
  const saved = holdings[assetId] ?? '';
  const invalid = !isValidAmountInput(draft);
  const dirty = isDirty(assetId);
  const saving = savingAsset === assetId;

  const draftAmount = parseAmount(draft);
  const savedAmount = parseAmount(saved);
  const unitPrice = assetId === STABLE_ID ? 1 : (priceUsd ?? null);

  const handleConfirm = async () => {
    const outcome = await saveHolding(assetId);
    setConfirming(false);
    push({
      tone: outcome.ok ? 'success' : 'error',
      title: outcome.message,
      ...(outcome.detail ? { description: outcome.detail } : {}),
    });
  };

  return (
    <>
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        <label className="sr-only" htmlFor={inputId}>
          Cantidad de {symbol} en tu cartera
        </label>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0"
          value={draft}
          aria-invalid={invalid}
          disabled={saving}
          onChange={(event) => setDraft(assetId, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && dirty && !invalid) setConfirming(true);
            if (event.key === 'Escape') resetDraft(assetId);
          }}
          className={`w-24 rounded-lg border bg-ink-950 px-2 py-1 text-right text-sm text-white transition placeholder:text-mist-400/60 focus:outline-none disabled:opacity-50 ${
            invalid
              ? 'border-bear-500 focus:border-bear-400'
              : dirty
                ? 'border-warn-400/70 focus:border-warn-400'
                : 'border-ink-600 focus:border-accent-400'
          }`}
        />
        <span aria-hidden="true" className="w-10 text-xs font-medium text-mist-400">
          {symbol}
        </span>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!dirty || invalid || saving}
          aria-label={`Guardar el saldo de ${symbol}`}
          title={
            invalid
              ? 'Corrige la cantidad antes de guardar'
              : dirty
                ? `Guardar el saldo de ${symbol}`
                : 'No hay cambios pendientes'
          }
          className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
            dirty && !invalid
              ? 'border-accent-400/60 bg-accent-400/10 text-accent-400 hover:bg-accent-400/20'
              : 'cursor-not-allowed border-ink-700 text-mist-400/60'
          }`}
        >
          {saving ? '…' : 'Guardar'}
        </button>
      </span>

      <ConfirmDialog
        open={confirming}
        busy={saving}
        title={`Confirmar el nuevo saldo de ${symbol}`}
        confirmLabel="Guardar cambio"
        tone={draftAmount < savedAmount ? 'danger' : 'default'}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void handleConfirm()}
      >
        <dl className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-ink-700 bg-ink-850/60 px-3 py-2">
            <dt className="text-xs text-mist-400">Saldo actual</dt>
            <dd className="text-sm font-semibold text-mist-200">
              {formatNumber(savedAmount, savedAmount < 1 ? 8 : 4)} {symbol}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 rounded-lg border border-accent-400/40 bg-accent-400/5 px-3 py-2">
            <dt className="text-xs text-mist-400">Nuevo saldo</dt>
            <dd className="text-sm font-bold text-white">
              {formatNumber(draftAmount, draftAmount < 1 ? 8 : 4)} {symbol}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-mist-400">
          Diferencia:{' '}
          <span className={draftAmount >= savedAmount ? 'text-bull-400' : 'text-bear-400'}>
            {draftAmount >= savedAmount ? '+' : ''}
            {formatNumber(draftAmount - savedAmount, 8)} {symbol}
          </span>
          {unitPrice !== null && unitPrice > 0 && (
            <> · valor {formatPrice(draftAmount * unitPrice)}</>
          )}
        </p>

        <p className="mt-2 text-[11px] text-mist-400">
          {persistenceMode === 'api'
            ? 'El cambio quedará registrado en el histórico con la fecha, el saldo anterior y el precio del momento.'
            : 'Sin servidor el cambio se guarda solo en este navegador y no se registra histórico.'}
        </p>
      </ConfirmDialog>
    </>
  );
}
