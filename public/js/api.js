/** Cliente mínimo de la API REST (la misma que puede usar una app móvil). */
import { DEMO, url } from './config.js';
import { demoRequest } from './demo-api.js';

const BASE = url('/api/v1');
const KEY = 'visited.session';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Error ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.field = body?.error?.field;
  }
}

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
export function setSession(s) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

let onUnauthorized = () => {};
export const handleUnauthorized = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body } = {}) {
  const session = getSession();
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  let res, data = null;
  if (DEMO) {
    // Versión de prueba: la "API" corre en el navegador (ver demo-api.js).
    const r = await demoRequest(method, path, body, session?.token);
    res = { status: r.status, ok: r.status < 400 };
    data = r.data;
  } else {
    try {
      res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { error: { message: 'No hay conexión con el servidor.' } });
    }
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON */ }
  }
  if (!res.ok) {
    if (res.status === 401 && session?.token && !path.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data;
}
