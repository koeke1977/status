/**
 * Cloudflare Worker — status-api.datuur.be
 *
 * Routes:
 *   POST /api/health   — receive health snapshot from booth (secret-protected)
 *   GET  /api/health   — return latest snapshot (served to status dashboard)
 *   GET  /             — return status dashboard HTML (optional — can also use CF Pages)
 *
 * KV binding: STATUS_KV  (key: "latest", key: "history")
 * Secrets:    STATUS_SECRET  (must match STATUS_API_SECRET in booth .env)
 *
 * Deploy:
 *   wrangler deploy --config workers/status/wrangler.jsonc
 */

const HISTORY_MIN_INTERVAL_MS = 10 * 60 * 1000; // write history at most every 10 min

// ── TOTP (RFC 6238 · SHA-1 · 30 s window · 6 digits) ─────────────────────────
function base32Decode(input) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const str = input.toUpperCase().replace(/[\s=]/g, '');
  const out = [];
  let bits = 0, val = 0;
  for (const ch of str) {
    const idx = alpha.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function generateTotpCode(secretB32, step) {
  const T = step ?? Math.floor(Date.now() / 30_000);
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, T >>> 0, false);
  const ck = await crypto.subtle.importKey(
    'raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', ck, buf));
  const off = mac[mac.length - 1] & 0x0f;
  const num = (((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) % 1_000_000;
  return num.toString().padStart(6, '0');
}

async function verifyTotp(secret, token) {
  if (!secret || !token) return false;
  const clean = token.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const T = Math.floor(Date.now() / 30_000);
  for (const step of [T - 1, T, T + 1]) {
    if (await generateTotpCode(secret, step) === clean) return true;
  }
  return false;
}

// ── Session tokens (stateless HMAC-signed · no KV needed) ──────────────────────
// Token format: `<expiresAt>.<signature>`  where signature = HMAC-SHA-256 over
// `<expiresAt>:<signingKey>` using ADMIN_PASSWORD as the key.
async function issueSession(env) {
  const exp = Date.now() + 28_800_000; // 8 h
  const sig = await _hmacSign(String(exp), env.ADMIN_PASSWORD);
  return `${exp}.${sig}`;
}

async function checkSession(env, token) {
  if (!token || !token.includes('.')) return false;
  const dot = token.indexOf('.');
  const exp = parseInt(token.slice(0, dot), 10);
  const sig = token.slice(dot + 1);
  if (!exp || Date.now() > exp) return false;
  const expected = await _hmacSign(String(exp), env.ADMIN_PASSWORD);
  // Constant-time compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

async function _hmacSign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Route /api/* to the worker; everything else falls through to static assets (index.html)
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      try {
        return await handleRequest(request, env);
      } catch (err) {
        console.error('[booth-status] Unhandled exception:', err?.message || String(err));
        return new Response(JSON.stringify({ ok: false, error: 'Internal server error.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }
    // event.datuur.be root → redirect to /event/ (QR display page)
    if (url.hostname === 'event.datuur.be' && (url.pathname === '/' || url.pathname === '')) {
      return Response.redirect(new URL('/event/', request.url).toString(), 302);
    }
    // Serve static assets (public/index.html, public/event/*, …) for all other paths
    return env.ASSETS.fetch(request);
  },
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ── CORS headers (dashboard is on a different origin)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Status-Secret, X-Admin-Token',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ── POST /api/health — booth pushes a snapshot
  if (method === 'POST' && path === '/api/health') {
    const secret = request.headers.get('X-Status-Secret') || '';
    if (!env.STATUS_SECRET || secret !== env.STATUS_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const boothId = body.boothId || 'booth-1';

    if (body.heartbeat) {
      // Tiny write: just the timestamp to prove the booth is reachable.
      // Non-fatal: if the write fails (quota, KV hiccup) we still return ok
      // so the booth doesn't log a warning and doesn't retry as a full snapshot.
      try {
        await env.STATUS_KV.put(`ping:${boothId}`, body.timestamp, { expirationTtl: 1200 });
      } catch (e) {
        console.warn('[booth-status] ping write failed:', e?.message);
      }
    } else {
      // Full snapshot — store and update history (both non-fatal)
      try {
        await env.STATUS_KV.put('latest', JSON.stringify(body), { expirationTtl: 86400 });
      } catch (e) {
        console.warn('[booth-status] latest write failed:', e?.message);
      }

      // Append to history (throttled: at most once every 10 min)
      try {
        const historyKey = `history:${boothId}`;
        let history = [];
        const raw = await env.STATUS_KV.get(historyKey);
        if (raw) history = JSON.parse(raw);

        const lastEntry = history[history.length - 1];
        const lastHistAge = lastEntry ? Date.now() - new Date(lastEntry.t).getTime() : Infinity;
        if (lastHistAge >= HISTORY_MIN_INTERVAL_MS) {
          history.push({
            t: body.timestamp,
            status: body.health?.overall ?? 'unknown',
            heapMB: body.memory?.heapUsedMB ?? null,
            photos: body.photosToday ?? 0,
          });
          if (history.length > 100) history = history.slice(-100);
          await env.STATUS_KV.put(historyKey, JSON.stringify(history), { expirationTtl: 86400 });
        }
      } catch (e) {
        console.warn('[booth-status] history write failed:', e?.message);
      }
    }

    // Always piggyback pending commands — non-fatal read
    let commands = [];
    try {
      const cmdKey = `cmds:${boothId}`;
      const rawCmds = await env.STATUS_KV.get(cmdKey);
      commands = rawCmds ? JSON.parse(rawCmds) : [];
    } catch { /* no commands available */ }

    return new Response(JSON.stringify({ ok: true, commands }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── GET /api/health — dashboard polls for latest snapshot
  if (method === 'GET' && path === '/api/health') {
    const raw = await env.STATUS_KV.get('latest');
    if (!raw) {
      return new Response(JSON.stringify({ online: false, reason: 'No data received yet' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const data = JSON.parse(raw);
    const ageMs = Date.now() - new Date(data.timestamp).getTime();
    // Online if a heartbeat or full snapshot arrived within the last 20 min.
    // The ping key (tiny, TTL 20 min) is the primary liveness indicator;
    // the full snapshot is the fallback for the very first push after startup.
    const pingTs = await env.STATUS_KV.get(`ping:${data.boothId || 'booth-1'}`);
    const pingAgeMs = pingTs ? Date.now() - new Date(pingTs).getTime() : Infinity;
    data.online = pingAgeMs < 1_200_000 || ageMs < 1_200_000;
    data.ageSeconds = Math.round(ageMs / 1000);       // age of last full snapshot
    data.lastSeenSeconds = Math.round(Math.min(pingAgeMs === Infinity ? ageMs : pingAgeMs, ageMs) / 1000); // age of last any contact

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── GET /api/history/:boothId — dashboard polls for graph data
  if (method === 'GET' && path.startsWith('/api/history/')) {
    const boothId = path.replace('/api/history/', '') || 'booth-1';
    const historyKey = `history:${boothId}`;
    const raw = await env.STATUS_KV.get(historyKey);
    const history = raw ? JSON.parse(raw) : [];

    return new Response(JSON.stringify(history), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── GET /api/commands — booth fast-polls for pending commands (read-only, no KV writes)
  // Called every 10 s by the booth so remote commands arrive within seconds.
  if (method === 'GET' && path === '/api/commands') {
    const secret = request.headers.get('X-Status-Secret') || '';
    if (!env.STATUS_SECRET || secret !== env.STATUS_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const boothId = url.searchParams.get('boothId') || 'booth-1';
    let commands = [];
    try {
      const raw = await env.STATUS_KV.get(`cmds:${boothId}`);
      commands = raw ? JSON.parse(raw) : [];
    } catch { /* non-fatal */ }
    return new Response(JSON.stringify({ commands }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── GET /api/admin/verify — check if a session token is still valid
  if (method === 'GET' && path === '/api/admin/verify') {
    const token = request.headers.get('X-Admin-Token') || '';
    const ok = await checkSession(env, token);
    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── POST /api/admin/login — password (+ TOTP if configured) → session token
  if (method === 'POST' && path === '/api/admin/login') {
    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const { password, totpCode } = body;
    if (!env.ADMIN_PASSWORD || !password || password.trim() !== env.ADMIN_PASSWORD.trim()) {
      return new Response(JSON.stringify({ ok: false, error: 'Ongeldig wachtwoord.' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // Password correct — check TOTP if the secret is configured
    if (env.TOTP_SECRET) {
      if (!totpCode) {
        // Tell the client to show the TOTP input
        return new Response(JSON.stringify({ ok: false, needsTotp: true }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      if (!(await verifyTotp(env.TOTP_SECRET, totpCode))) {
        return new Response(JSON.stringify({ ok: false, error: 'Ongeldige authenticatiecode.' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }
    const token = await issueSession(env);
    return new Response(JSON.stringify({ ok: true, token }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── POST /api/command — queue a remote command (admin-protected)
  if (method === 'POST' && path === '/api/command') {
    const token = request.headers.get('X-Admin-Token') || '';
    if (!(await checkSession(env, token))) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const { eventId, action, value, boothId = 'booth-1' } = body;
    const BOOL_ACTIONS = ['setFaceRecognition', 'setAutoConfirm', 'setBoomerang', 'setSmileShutter', 'setArFilters', 'setSlideshow', 'setSendQrEmails'];
    const SYSTEM_ACTIONS = ['restartBooth', 'restartServices'];
    const VALID_ACTIONS = [...BOOL_ACTIONS, ...SYSTEM_ACTIONS, 'switchEvent', 'setLayouts', 'setSlideshowIdleTimer', 'clearQueue'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid command' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // clearQueue wipes the KV queue immediately — no point queueing "clear queue" itself
    if (action === 'clearQueue') {
      await env.STATUS_KV.delete(`cmds:${boothId}`);
      return new Response(JSON.stringify({ ok: true, cleared: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // Most commands need eventId; system commands and switchEvent target a new event via value
    if (!SYSTEM_ACTIONS.includes(action) && action !== 'switchEvent' && !eventId) {
      return new Response(JSON.stringify({ ok: false, error: 'eventId required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    if (action === 'switchEvent' && !value) {
      return new Response(JSON.stringify({ ok: false, error: 'switchEvent requires value (target eventId)' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const id = crypto.randomUUID().slice(0, 12);
    const cmdKey = `cmds:${boothId}`;
    const rawCmds = await env.STATUS_KV.get(cmdKey);
    const cmds = rawCmds ? JSON.parse(rawCmds) : [];
    // Preserve correct value types: booleans for toggles, number for timer, string for the rest
    const storedValue = BOOL_ACTIONS.includes(action) ? !!value
      : action === 'setSlideshowIdleTimer' ? Number(value)
        : value ?? null;
    cmds.push({ id, eventId: eventId || null, action, value: storedValue, boothId, createdAt: new Date().toISOString() });
    await env.STATUS_KV.put(cmdKey, JSON.stringify(cmds), { expirationTtl: 300 });
    return new Response(JSON.stringify({ ok: true, id }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // ── POST /api/commands/ack — booth acks processed commands (piggybacked on POST /api/health)
  if (method === 'POST' && path === '/api/commands/ack') {
    const secret = request.headers.get('X-Status-Secret') || '';
    if (!env.STATUS_SECRET || secret !== env.STATUS_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    let body;
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const { ids, boothId = 'booth-1' } = body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'ids[] required' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // Single GET + PUT/DELETE instead of LIST + N GETs + N DELETEs (saves list quota)
    const cmdKey = `cmds:${boothId}`;
    const rawCmds = await env.STATUS_KV.get(cmdKey);
    const cmds = rawCmds ? JSON.parse(rawCmds) : [];
    const remaining = cmds.filter(c => !ids.includes(c.id));
    const deleted = cmds.length - remaining.length;
    if (remaining.length === 0) {
      await env.STATUS_KV.delete(cmdKey);
    } else {
      await env.STATUS_KV.put(cmdKey, JSON.stringify(remaining), { expirationTtl: 300 });
    }
    return new Response(JSON.stringify({ ok: true, deleted }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  return new Response('Not Found', { status: 404 });
}
