import { badRequest } from './errors.js';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function str(body, key, { required = false, min = 0, max = 200, trim = true } = {}) {
  let v = body?.[key];
  if (v === undefined || v === null) {
    if (required) throw badRequest(`Falta el campo "${key}".`, { field: key });
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`"${key}" debe ser texto.`, { field: key });
  if (trim) v = v.trim();
  if (v.length < min) throw badRequest(`"${key}" debe tener al menos ${min} caracteres.`, { field: key });
  if (v.length > max) throw badRequest(`"${key}" puede tener como máximo ${max} caracteres.`, { field: key });
  return v;
}

export function username(body) {
  const v = str(body, 'username', { required: true, max: 20 });
  if (!USERNAME_RE.test(v)) {
    throw badRequest('El nombre de usuario debe tener entre 3 y 20 caracteres: letras, números o "_".', { field: 'username' });
  }
  return v;
}

export function email(body) {
  const v = str(body, 'email', { required: true, max: 254 });
  if (!EMAIL_RE.test(v)) throw badRequest('Email inválido.', { field: 'email' });
  return v.toLowerCase();
}

export function password(body, key = 'password') {
  const v = str(body, key, { required: true, max: 200, trim: false });
  if (v.length < 8) throw badRequest('La contraseña debe tener al menos 8 caracteres.', { field: key });
  return v;
}

export function bool(body, key) {
  const v = body?.[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw badRequest(`"${key}" debe ser true o false.`, { field: key });
  return v;
}

export function rating(body) {
  const v = body?.rating;
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Number.isInteger(v) || v < 1 || v > 5) throw badRequest('La evaluación debe ser un entero entre 1 y 5.', { field: 'rating' });
  return v;
}

export function isoDate(body, key) {
  const v = body?.[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest(`"${key}" debe tener formato AAAA-MM-DD.`, { field: key });
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw badRequest(`"${key}" no es una fecha válida.`, { field: key });
  if (v < '1900-01-01' || d.getTime() > Date.now() + 864e5) throw badRequest(`"${key}" no puede ser una fecha futura.`, { field: key });
  return v;
}

export function pagination(query, { defLimit = 20, maxLimit = 100 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defLimit));
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  return { limit, offset };
}
