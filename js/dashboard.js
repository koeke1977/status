/**
 * dashboard.js — main orchestrator
 * Boots the app, wires up polling, handles session persistence.
 */

import { fetchHealth, verifyToken, sendCommand } from './api.js';
import {
    el, renderStatusPill, setOfflineBanner, renderActiveEvent,
    renderStatCards, renderInfoRow, renderMemoryBar,
    renderServices, renderErrors, renderSparkline,
    renderFeaturesOverview, updateTimestamp,
} from './ui.js';
import {
    ADMIN_TOGGLES, setAdminToken, resetPending,
    renderAdminPanel, markPending, markLayoutPending, markTimerPending, saveChanges,
} from './admin.js';

// ── Session ───────────────────────────────────────────────────────────────────

let _adminToken = localStorage.getItem('adminToken') || null;
let _pollTimer = null;
let _firstLoad = true;
let _lastData = null;

const POLL_MS = 60_000;

// ── Expose globals needed by inline event handlers ────────────────────────────

window._adminMarkPending = (action, value, eventId) => {
    markPending(action, value, eventId);
    if (_lastData) renderAdminPanel(_lastData);
};
window._adminMarkLayout = (layoutId, enabled, eventId) => {
    markLayoutPending(layoutId, enabled, eventId);
    if (_lastData) renderAdminPanel(_lastData);
};
window._adminMarkTimer = (seconds, eventId) => {
    markTimerPending(seconds, eventId);
    if (_lastData) renderAdminPanel(_lastData);
};
window.saveChanges = saveChanges;

// ── Render all sections ───────────────────────────────────────────────────────

function render(data) {
    _lastData = data;
    el('loadingState').style.display = 'none';
    el('mainContent').style.display = 'block';

    const online = data.online !== false;
    setOfflineBanner(!online, null);

    renderStatusPill(data);
    renderActiveEvent(data);
    renderEventSwitcher(data);
    renderStatCards(data);
    renderInfoRow(data);
    renderMemoryBar(data);
    renderServices(data);
    renderErrors(data);
    renderFeaturesOverview(data, ADMIN_TOGGLES);
    updateTimestamp();

    if (_adminToken) {
        el('adminPanel').classList.add('visible');
        renderAdminPanel(data);
    }

    _firstLoad = false;
}
// ── Event switcher ─────────────────────────────────────────────────────────────────

function renderEventSwitcher(data) {
    const wrap = el('eventSwitcherWrap');
    const select = el('eventSwitcher');
    if (!wrap || !select) return;
    if (!_adminToken || !data.events?.length || data.events.length < 2) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'block';
    const currentId = data.activeEvent?.id || '';
    select.innerHTML = data.events
        .map(ev => `<option value="${ev.id}" ${ev.id === currentId ? 'selected' : ''}>${ev.name}${ev.active ? ' ✓' : ''}</option>`)
        .join('');
}

export async function doSwitchEvent(targetId) {
    if (!_adminToken || !targetId) return;
    const target = _lastData?.events?.find(e => e.id === targetId);
    const name = target?.name || targetId;
    if (!confirm(`Wil je overschakelen naar "${name}"?\nDe booth schakelt over bij de volgende synchronisatie (~10 sec).`)) {
        const sel = el('eventSwitcher');
        if (sel) sel.value = _lastData?.activeEvent?.id || '';
        return;
    }
    try {
        const d = await sendCommand(_adminToken, { action: 'switchEvent', value: targetId });
        const fb = el('saveFeedback');
        fb.textContent = d.ok ? `✅ Overschakelen naar "${name}" aangevraagd…` : `⚠ ${d.error || 'Mislukt'}`;
        fb.style.color = d.ok ? 'var(--green)' : 'var(--orange)';
        fb.style.display = 'inline';
        setTimeout(() => { fb.style.display = 'none'; }, 5000);
    } catch (err) { console.error('[dashboard] doSwitchEvent:', err.message); }
}

export async function doRestartBooth() {
    if (!_adminToken) return;
    if (!confirm('Wil je de booth volledig herstarten?\nDe app sluit en herstart (±30 seconden offline).')) return;
    try {
        const d = await sendCommand(_adminToken, { action: 'restartBooth' });
        if (d.ok) setOfflineBanner(true, '⟳ Herstart aangevraagd — booth is zo terug…');
    } catch (err) { console.error('[dashboard] doRestartBooth:', err.message); }
}

export async function doRestartServices() {
    if (!_adminToken) return;
    if (!confirm('Wil je alle services herstarten?\n(Dropbox, Foto pipeline, Database)')) return;
    try {
        const d = await sendCommand(_adminToken, { action: 'restartServices' });
        const fb = el('saveFeedback');
        fb.textContent = d.ok ? '✅ Services worden herstart…' : `⚠ ${d.error || 'Mislukt'}`;
        fb.style.color = d.ok ? 'var(--green)' : 'var(--orange)';
        fb.style.display = 'inline';
        setTimeout(() => { fb.style.display = 'none'; }, 4000);
    } catch (err) { console.error('[dashboard] doRestartServices:', err.message); }
}

export async function doClearQueue() {
    if (!_adminToken) return;
    if (!confirm('Wil je de command queue wissen?\nAlle openstaande remote commando\'s worden verwijderd.')) return;
    try {
        const d = await sendCommand(_adminToken, { action: 'clearQueue' });
        const fb = el('saveFeedback');
        fb.textContent = d.ok ? '✅ Queue gewist' : `⚠ ${d.error || 'Mislukt'}`;
        fb.style.color = d.ok ? 'var(--green)' : 'var(--orange)';
        fb.style.display = 'inline';
        setTimeout(() => { fb.style.display = 'none'; }, 3000);
    } catch (err) { console.error('[dashboard] doClearQueue:', err.message); }
}
// ── Fetch + render cycle ──────────────────────────────────────────────────────

export async function doFetchHealth() {
    try {
        const { data, history } = await fetchHealth();
        render(data);
        renderSparkline(history);
    } catch (err) {
        if (_firstLoad) {
            el('loadingState').innerHTML = `
        <div style="color:var(--red);font-size:.9rem">⚠ Kan status niet ophalen</div>
        <div style="color:var(--muted);font-size:.78rem;margin-top:8px">${err.message}</div>
        <div style="color:var(--muted);font-size:.72rem;margin-top:4px">Herlaad de pagina om opnieuw te proberen</div>`;
            el('loadingState').style.display = 'block';
        } else {
            setOfflineBanner(true, `⚠ Kan statusdata niet ophalen: ${err.message}`);
        }
        el('lastUpdated').textContent =
            `Fout om ${new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`;
    }
}

// ── Show app after login ──────────────────────────────────────────────────────

export function showApp(token) {
    _adminToken = token;
    setAdminToken(token);
    localStorage.setItem('adminToken', token);

    el('mainContent').style.display = 'none'; // reset for fresh render
    _firstLoad = true;
    doFetchHealth();
    _pollTimer = setInterval(doFetchHealth, POLL_MS);
}

// ── Logout ────────────────────────────────────────────────────────────────────

export function logout() {
    _adminToken = null;
    _lastData = null;
    setAdminToken(null);
    resetPending();
    localStorage.removeItem('adminToken');
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

    el('adminPanel').classList.remove('visible');
    // Redirect to login
    window.location.href = '/login.html';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
    // Migrate: clear old pw key
    if (localStorage.getItem('adminPw')) {
        localStorage.removeItem('adminPw');
        _adminToken = null;
        localStorage.removeItem('adminToken');
    }

    if (_adminToken) {
        const { ok } = await verifyToken(_adminToken);
        if (ok) {
            showApp(_adminToken);
        } else {
            _adminToken = null;
            localStorage.removeItem('adminToken');
            window.location.href = '/login.html';
        }
    } else {
        window.location.href = '/login.html';
    }
})();

// ── Visibility-based polling ──────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
    if (!_adminToken) return;
    if (document.hidden) {
        clearInterval(_pollTimer);
        _pollTimer = null;
    } else {
        doFetchHealth();
        _pollTimer = setInterval(doFetchHealth, POLL_MS);
    }
});

// ── Button wiring (called from HTML) ─────────────────────────────────────────

window.doRefresh = doFetchHealth;
window.doLogout = logout;
window.doRestartBooth = doRestartBooth;
window.doRestartServices = doRestartServices;
window.doClearQueue = doClearQueue;
window.doSwitchEvent = doSwitchEvent;
