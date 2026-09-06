/** Error con código HTTP, para que las rutas no manipulen `res` en cada fallo. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }
  static unauthorized(message = 'No autenticado.'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }
  static forbidden(message = 'No tienes permiso para esta operación.'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = 'Recurso no encontrado.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }
  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }
}
