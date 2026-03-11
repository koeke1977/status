/**
 * event.js — Live event QR display
 *
 * Polls GET /api/health every 15 s and renders:
 *   • Event name (neon red)
 *   • QR code linking to registreer.datuur.be for the active event
 *   • LIVE badge when the booth is online with an active event
 *   • Status footer showing last-contact age
 *
 * Falls back to localStorage cache when the booth is offline or has no
 * active event, so a QR is always shown if we've seen one before.
 *
 * Requires qrcodejs to be loaded BEFORE this module (global QRCode).
 */

const TOKEN_KEY = 'adminToken';
const CACHE_KEY = 'event_lastEventData';
const POLL_MS = 15_000;               // refresh every 15 s
const REG_BASE = 'https://registreer.datuur.be';

// ── Auth guard ────────────────────────────────────────────────────────────────
const _token = localStorage.getItem(TOKEN_KEY);
if (!_token) {
    window.location.replace('/event/login.html');
}

// ── Non-blocking token verify (redirect if expired) ──────────────────────────
fetch('/api/admin/verify', { headers: { 'X-Admin-Token': _token }, cache: 'no-store' })
    .then(r => r.json())
    .then(d => {
        if (!d.ok) {
            localStorage.removeItem(TOKEN_KEY);
            window.location.replace('/event/login.html');
        }
    })
    .catch(() => { /* offline — continue showing cached data */ });

// ── QR code generation (uses qrcodejs global) ─────────────────────────────────
let _qrInstance = null;
let _lastQrUrl = null;

function renderQr(url) {
    if (!url) return;
    if (url === _lastQrUrl && _qrInstance) return; // nothing changed
    _lastQrUrl = url;

    const box = document.getElementById('qrBox');
    if (!box) return;

    // Remove the spinner placeholder on first render
    const placeholder = document.getElementById('qrPlaceholder');
    if (placeholder) placeholder.remove();

    if (_qrInstance) {
        // Update existing QR (avoids DOM churn)
        _qrInstance.makeCode(url);
    } else {
        // Create new QR — QRCode is loaded via <script> tag before this module
        _qrInstance = new QRCode(box, {   // eslint-disable-line no-undef
            text: url,
            width: 260,
            height: 260,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H, // eslint-disable-line no-undef
        });
    }
}

// ── Render event state ────────────────────────────────────────────────────────
function renderState(event, boothOnline) {
    if (!event) return;

    // Event name
    const nameEl = document.getElementById('eventName');
    if (nameEl) nameEl.textContent = event.name || 'Onbekend event';

    // LIVE badge — only green when booth is reachable AND event is active
    const liveRow = document.getElementById('liveRow');
    if (liveRow) liveRow.hidden = !boothOnline;

    // Registration URL (pre-computed by booth in snapshot, or constructed here as fallback)
    const regUrl = event.registrationUrl ||
        `${REG_BASE}/?event=${encodeURIComponent(event.id)}&name=${encodeURIComponent(event.name || event.id)}`;

    renderQr(regUrl);
}

// ── Status footer ─────────────────────────────────────────────────────────────
function renderFooter(data) {
    const el = document.getElementById('statusFooter');
    if (!el) return;

    if (!data) {
        el.textContent = '⚡ Geen verbinding — cached gegevens';
        return;
    }

    const s = data.lastSeenSeconds ?? data.ageSeconds ?? null;
    const ago = s != null ? formatAge(s) + ' geleden' : '—';

    el.textContent = data.online
        ? `🟢 Booth online · ${ago}`
        : `🔴 Booth offline · Laatste contact: ${ago}`;
}

function formatAge(s) {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${Math.round(s / 3600)} u`;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
function saveCache(event) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(event)); } catch { /* quota */ }
}

function loadCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// ── Poll ──────────────────────────────────────────────────────────────────────
async function poll() {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.disabled = true;

    try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const data = await r.json();

        const ev = data.activeEvent ?? null;
        const online = data.online ?? false;

        if (ev) {
            saveCache(ev);
            renderState(ev, online);
        } else {
            // No active event right now — fall back to cache but mark as not live
            const cached = loadCache();
            if (cached) renderState(cached, false);
        }

        renderFooter(data);
    } catch {
        // Network error — show cached data silently
        const cached = loadCache();
        if (cached) renderState(cached, false);
        renderFooter(null);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// 1. Show cached data immediately (no blank flash while fetching)
const _immediate = loadCache();
if (_immediate) renderState(_immediate, false);

// 2. First real poll
poll();

// 3. Start polling interval
setInterval(poll, POLL_MS);

// 4. Manual refresh button
window._doRefresh = () => poll();
