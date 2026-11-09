export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Debes iniciar sesión.') => new ApiError(401, 'unauthorized', message);
export const notFound = (message = 'No encontrado.') => new ApiError(404, 'not_found', message);
export const conflict = (message, details) => new ApiError(409, 'conflict', message, details);
export const tooMany = (message = 'Demasiados intentos. Espera unos minutos.') => new ApiError(429, 'rate_limited', message);
