import { useId } from 'react';
import { isValidAmountInput } from '../lib/portfolio';

interface HoldingInputProps {
  symbol: string;
  value: string;
  onChange: (rawValue: string) => void;
  className?: string;
}

/**
 * Campo de cantidad. Es `type="text"` con `inputMode="decimal"` en lugar de
 * `type="number"`: el input numérico nativo rechaza la coma decimal en muchas
 * combinaciones de navegador y configuración regional, y aquí el usuario
 * escribe en español.
 */
export function HoldingInput({ symbol, value, onChange, className = '' }: HoldingInputProps) {
  const id = useId();
  const invalid = !isValidAmountInput(value);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <label htmlFor={id} className="sr-only">
        Cantidad de {symbol} en tu cartera
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder="0"
        value={value}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`w-24 rounded-lg border bg-ink-950 px-2 py-1 text-right text-sm text-white transition placeholder:text-mist-400/60 focus:outline-none ${
          invalid
            ? 'border-bear-500 focus:border-bear-400'
            : 'border-ink-600 focus:border-accent-400'
        }`}
      />
      <span aria-hidden="true" className="text-xs font-medium text-mist-400">
        {symbol}
      </span>
      {invalid && (
        <span id={`${id}-error`} className="sr-only">
          Introduce solo cifras, con coma o punto decimal.
        </span>
      )}
    </span>
  );
}
