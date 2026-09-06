/**
 * Cliente del API. La aplicación debe seguir funcionando sin backend: hasta
 * ahora era 100 % cliente, y perder esa capacidad sería una regresión. Por eso
 * cada llamada distingue "el servidor respondió un error" de "no hay servidor",
 * y el contexto decide caer a LocalStorage solo en el segundo caso.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ApiUnavailableError(
      error instanceof Error ? error.message : 'No se pudo contactar con el servidor.',
    );
  }

  if (response.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Una respuesta sin JSON válido con estado de error sigue siendo un error.
    if (!response.ok) {
      throw new ApiRequestError(response.status, 'invalid_response', `HTTP ${response.status}.`);
    }
  }

  if (!response.ok) {
    const error = (body as ErrorBody)?.error;
    // 5xx significa que el servidor está, pero roto: no es motivo para pasar a
    // modo local y perder los datos ya guardados en la base.
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `El servidor respondió ${response.status}.`,
    );
  }

  return body as T;
}

export interface ApiUser {
  id: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  authMode: string;
}

export interface ApiHolding {
  symbol: string;
  name: string;
  kind: string;
  amount: string;
  updatedAt: string | null;
}

export interface SaveHoldingResult {
  ok: true;
  symbol: string;
  amount: string;
  amountBefore: string;
  updatedAt: string | null;
  transaction: { id: number; delta: string; createdAt: string | null };
}

export interface HoldingTransaction {
  id: number;
  symbol?: string;
  kind: string;
  amount_before: string;
  amount_after: string;
  delta: string;
  unit_price_usd: string | null;
  value_usd: string | null;
  note: string | null;
  created_at: string;
}

export interface AnalysisRunSummary {
  id: number;
  engine_version: string;
  trigger_source: string;
  generated_at: string;
  total_value_usd: string | null;
  crypto_value_usd: string | null;
  stable_value_usd: string | null;
  exposure_pct: string | null;
  short_term_score: number | null;
  short_term_symbol: string | null;
  recommendation_count: number;
}

export const api = {
  health: () => request<{ ok: boolean; database: string }>('/health'),
  me: () => request<ApiUser>('/me'),
  holdings: () => request<{ holdings: ApiHolding[] }>('/holdings'),

  saveHolding: (symbol: string, payload: { amount: string; note?: string; unitPriceUsd?: string }) =>
    request<SaveHoldingResult>(`/holdings/${encodeURIComponent(symbol)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  holdingHistory: (symbol: string, limit = 20) =>
    request<{ symbol: string; transactions: HoldingTransaction[] }>(
      `/holdings/${encodeURIComponent(symbol)}/history?limit=${limit}`,
    ),

  allHistory: (limit = 50) =>
    request<{ transactions: HoldingTransaction[] }>(`/holdings/history/all?limit=${limit}`),

  createAnalysisRun: (payload: unknown) =>
    request<{ ok: true; runId: number }>('/analysis/runs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  analysisRuns: (limit = 20) =>
    request<{ runs: AnalysisRunSummary[] }>(`/analysis/runs?limit=${limit}`),

  portfolioSummary: () =>
    request<{
      latest: {
        current_value: string;
        previous_value: string | null;
        change_pct: string | null;
        captured_at: string;
      } | null;
      totals: { runs: number; transactions: number };
    }>('/portfolio/summary'),
};
