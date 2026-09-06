import { ApiError } from './errors.ts';

/**
 * Validación a mano en lugar de un esquema declarativo: la superficie de la
 * API es pequeña y así el proyecto no añade otra dependencia solo para esto.
 */

export function asObject(value: unknown, field = 'cuerpo'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw ApiError.badRequest(`El campo "${field}" debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string') throw ApiError.badRequest(`"${field}" debe ser texto.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw ApiError.badRequest(`"${field}" supera los ${maxLength} caracteres.`);
  }
  return trimmed;
}

export function asOptionalString(value: unknown, field: string, maxLength = 500): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asString(value, field, maxLength);
}

/**
 * Los importes llegan como texto para no perder precisión en el JSON, y se
 * validan contra el formato decimal que acepta Postgres. Se devuelve la cadena
 * normalizada, no un número: convertir a double aquí reintroduciría el error
 * que numeric evita.
 */
const DECIMAL_PATTERN = /^\d{1,20}(\.\d{1,18})?$/;

export function asDecimalString(value: unknown, field: string): string {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string') throw ApiError.badRequest(`"${field}" debe ser un número decimal.`);
  const normalized = raw.trim().replace(',', '.');
  if (!DECIMAL_PATTERN.test(normalized)) {
    throw ApiError.badRequest(
      `"${field}" no es un decimal válido (máximo 20 enteros y 18 decimales, sin signo).`,
    );
  }
  return normalized;
}

export function asOptionalDecimalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return asDecimalString(value, field);
}

export function asNumber(value: unknown, field: string, min?: number, max?: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw ApiError.badRequest(`"${field}" debe ser numérico.`);
  }
  if (min !== undefined && parsed < min) {
    throw ApiError.badRequest(`"${field}" debe ser como mínimo ${min}.`);
  }
  if (max !== undefined && parsed > max) {
    throw ApiError.badRequest(`"${field}" debe ser como máximo ${max}.`);
  }
  return parsed;
}

export function asOptionalNumber(
  value: unknown,
  field: string,
  min?: number,
  max?: number,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return asNumber(value, field, min, max);
}

export function asEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const text = asString(value, field, 64);
  if (!(allowed as readonly string[]).includes(text)) {
    throw ApiError.badRequest(`"${field}" debe ser uno de: ${allowed.join(', ')}.`);
  }
  return text as T;
}

export function asArray(value: unknown, field: string, maxItems = 200): unknown[] {
  if (!Array.isArray(value)) throw ApiError.badRequest(`"${field}" debe ser una lista.`);
  if (value.length > maxItems) {
    throw ApiError.badRequest(`"${field}" supera los ${maxItems} elementos.`);
  }
  return value;
}
