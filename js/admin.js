/**
 * admin.js — admin panel: feature toggles, pending changes, save/commands
 */

import { sendCommand } from './api.js';
import { el } from './ui.js';

export const ADMIN_TOGGLES = [
  { action: 'setFaceRecognition', label: '👁 Face herkenning',  key: 'face_recognition_enabled' },
  { action: 'setAutoConfirm',     label: '⚡ Auto-bevestig',    key: 'auto_confirm_recognition' },
  { action: 'setBoomerang',       label: '🔄 Boomerang GIF',    key: 'boomerang_enabled'         },
  { action: 'setSendQrEmails',    label: '📧 QR emails',        key: 'send_qr_emails'            },
  { action: 'setSmileShutter',    label: '😊 Smile sluiter',    key: 'smile_shutter_enabled'     },
  { action: 'setArFilters',       label: '🎭 AR filters',       key: 'ar_filters_enabled'        },
  { action: 'setSlideshow',       label: '🖼 Slideshow',        key: 'slideshow_enabled'         },
];

let _pendingChanges = {};
let _adminToken     = null;

export function setAdminToken(token) {
  _adminToken = token;
}

export function resetPending() {
  _pendingChanges = {};
}

export function renderAdminPanel(data) {
  const ev = data.activeEvent;
  el('adminEventName').textContent = ev ? (ev.name || ev.id) : '(geen event)';

  if (!ev) {
    el('adminToggles').innerHTML =
      '<div style="color:var(--muted);font-size:.82rem">Geen actief evenement</div>';
    return;
  }

  el('adminToggles').innerHTML = ADMIN_TOGGLES.map(t => {
    const serverVal    = ev[t.key] === true;
    const hasPending   = Object.prototype.hasOwnProperty.call(_pendingChanges, t.action);
    const effectiveVal = hasPending ? _pendingChanges[t.action] : serverVal;
    const checked      = effectiveVal ? 'checked' : '';
    const dirty        = hasPending && _pendingChanges[t.action] !== serverVal ? 'dirty' : '';
    return `
      <div class="toggle-row ${dirty}">
        <span class="toggle-label">${t.label}</span>
        <label class="toggle-switch">
          <input type="checkbox" ${checked}
            onchange="window._adminMarkPending('${t.action}', this.checked, '${ev.id}')">
          <span class="toggle-track"></span>
        </label>
      </div>`;
  }).join('');

  _updateSaveBar();
}

// Called from inline onchange handlers (needs global exposure — done in dashboard.js)
export function markPending(action, value, eventId) {
  _pendingChanges[action]   = value;
  _pendingChanges._eventId  = eventId;
  _updateSaveBar();
  // Trigger re-render of dirty borders — dashboard.js subscribes via onPendingChange
  window.dispatchEvent(new CustomEvent('admin:pendingChanged'));
}

function _updateSaveBar() {
  const count = Object.keys(_pendingChanges).filter(k => k !== '_eventId').length;
  const btn   = el('saveBtn');
  const cnt   = el('pendingCount');
  if (count > 0) {
    btn.classList.add('has-changes');
    cnt.textContent = `${count} wijziging${count > 1 ? 'en' : ''} klaar om op te slaan`;
    cnt.style.color = 'var(--accent)';
  } else {
    btn.classList.remove('has-changes');
    cnt.textContent = 'Geen wijzigingen';
    cnt.style.color = 'var(--muted)';
  }
}

export async function saveChanges() {
  const eventId = _pendingChanges._eventId;
  const actions = Object.keys(_pendingChanges).filter(k => k !== '_eventId');
  if (!actions.length || !eventId || !_adminToken) return;

  const btn = el('saveBtn');
  btn.disabled    = true;
  btn.textContent = 'Opslaan…';

  let allOk = true;
  for (const action of actions) {
    try {
      const d = await sendCommand(_adminToken, {
        eventId,
        action,
        value: _pendingChanges[action],
      });
      if (!d.ok) { allOk = false; console.warn('[admin] command rejected:', d.error); }
    } catch (err) {
      allOk = false;
      console.error('[admin] sendCommand failed:', err.message);
    }
  }

  _pendingChanges = {};
  btn.disabled    = false;
  btn.textContent = '💾 Opslaan';
  btn.classList.remove('has-changes');
  el('pendingCount').textContent = '';

  const fb = el('saveFeedback');
  fb.textContent    = allOk ? '✅ Opgeslagen!' : '⚠ Gedeeltelijk opgeslagen';
  fb.style.color    = allOk ? 'var(--green)'   : 'var(--orange)';
  fb.style.display  = 'inline';
  setTimeout(() => { fb.style.display = 'none'; }, 3000);
}
