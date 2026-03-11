/**
 * api.js — all fetch calls to status-api.datuur.be
 * Exports:
 *   fetchHealth()            → { data, history }
 *   adminLogin(pw)           → { ok, token?, needsTotp?, error? }
 *   adminLoginTotp(pw, code) → { ok, token?, error? }
 *   verifyToken(token)       → { ok }
 *   sendCommand(token, payload) → { ok, error? }
 */

export const API_BASE = 'https://status-api.datuur.be';
export const BOOTH_ID = 'booth-1';

export async function fetchHealth() {
  const [healthRes, historyRes] = await Promise.all([
    fetch(`${API_BASE}/api/health`,              { cache: 'no-store' }),
    fetch(`${API_BASE}/api/history/${BOOTH_ID}`, { cache: 'no-store' }),
  ]);
  if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
  const data    = await healthRes.json();
  const history = historyRes.ok ? await historyRes.json() : [];
  return { data, history };
}

export async function adminLogin(password) {
  const r = await fetch(`${API_BASE}/api/admin/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
    cache:   'no-store',
  });
  return r.json();
}

export async function adminLoginTotp(password, totpCode) {
  const r = await fetch(`${API_BASE}/api/admin/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password, totpCode }),
    cache:   'no-store',
  });
  return r.json();
}

export async function verifyToken(token) {
  try {
    const r = await fetch(`${API_BASE}/api/admin/verify`, {
      headers: { 'X-Admin-Token': token },
      cache:   'no-store',
    });
    return r.json();
  } catch {
    return { ok: false };
  }
}

export async function sendCommand(token, payload) {
  const r = await fetch(`${API_BASE}/api/command`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body:    JSON.stringify({ ...payload, boothId: BOOTH_ID }),
    cache:   'no-store',
  });
  return r.json();
}
