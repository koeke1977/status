/**
 * api.js — all fetch calls to the status API
 * Uses relative paths (/api/...) so this works whether served from
 * status-api.datuur.be or status.datuur.be — same origin, no CORS needed.
 */

export const BOOTH_ID = 'booth-1';

export async function fetchHealth() {
  const [healthRes, historyRes] = await Promise.all([
    fetch(`/api/health`,              { cache: 'no-store' }),
    fetch(`/api/history/${BOOTH_ID}`, { cache: 'no-store' }),
  ]);
  if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
  const data    = await healthRes.json();
  const history = historyRes.ok ? await historyRes.json() : [];
  return { data, history };
}

export async function adminLogin(password) {
  const r = await fetch('/api/admin/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password }),
    cache:   'no-store',
  });
  return r.json();
}

export async function adminLoginTotp(password, totpCode) {
  const r = await fetch('/api/admin/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ password, totpCode }),
    cache:   'no-store',
  });
  return r.json();
}

export async function verifyToken(token) {
  try {
    const r = await fetch('/api/admin/verify', {
      headers: { 'X-Admin-Token': token },
      cache:   'no-store',
    });
    return r.json();
  } catch {
    return { ok: false };
  }
}

export async function sendCommand(token, payload) {
  const r = await fetch('/api/command', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
    body:    JSON.stringify({ ...payload, boothId: BOOTH_ID }),
    cache:   'no-store',
  });
  return r.json();
}
