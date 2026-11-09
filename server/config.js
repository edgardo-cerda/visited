import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export const config = {
  port: Number(process.env.PORT) || 3000,
  /** Ruta del archivo SQLite. Usa ":memory:" para pruebas. */
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'visited.db'),
  /** Días de validez de un token de sesión. */
  tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS) || 60,
  /**
   * Orígenes permitidos para CORS (separados por coma). "*" permite cualquiera;
   * es seguro porque la API usa tokens Bearer, no cookies.
   */
  corsOrigins: list(process.env.CORS_ORIGINS || '*'),
  /** Valor para `trust proxy` de Express (p. ej. "1" detrás de un proxy/reverse proxy). */
  trustProxy: process.env.TRUST_PROXY ? (Number.isNaN(Number(process.env.TRUST_PROXY)) ? process.env.TRUST_PROXY : Number(process.env.TRUST_PROXY)) : false,
  /** Límite de intentos de login/registro por IP cada 15 minutos. */
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT) || 30,
};
