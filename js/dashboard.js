/**
 * dashboard.js — main orchestrator
 * Boots the app, wires up polling, handles session persistence.
 */

import { fetchHealth, verifyToken } from './api.js';
import {
  el, renderStatusPill, setOfflineBanner, renderActiveEvent,
  renderStatCards, renderInfoRow, renderMemoryBar,
  renderServices, renderErrors, renderSparkline,
  renderFeaturesOverview, updateTimestamp,
} from './ui.js';
import {
  ADMIN_TOGGLES, setAdminToken, resetPending,
  renderAdminPanel, markPending, saveChanges,
} from './admin.js';

// ── Session ───────────────────────────────────────────────────────────────────

let _adminToken  = localStorage.getItem('adminToken') || null;
let _pollTimer   = null;
let _firstLoad   = true;
let _lastData    = null;

const POLL_MS = 60_000;

// ── Expose globals needed by inline event handlers ────────────────────────────

window._adminMarkPending = (action, value, eventId) => {
  markPending(action, value, eventId);
  if (_lastData) renderAdminPanel(_lastData);
};
window.saveChanges = saveChanges;

// ── Render all sections ───────────────────────────────────────────────────────

function render(data) {
  _lastData = data;
  el('loadingState').style.display = 'none';
  el('mainContent').style.display  = 'block';

  const online = data.online !== false;
  setOfflineBanner(!online, null);

  renderStatusPill(data);
  renderActiveEvent(data);
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
  _lastData   = null;
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
window.doLogout  = logout;
