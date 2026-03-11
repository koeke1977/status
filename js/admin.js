/**
 * admin.js — admin panel: feature toggles, pending changes, save/commands
 */

import { sendCommand } from './api.js';
import { el } from './ui.js';

export const ADMIN_TOGGLES = [
    { action: 'setFaceRecognition', label: '👁 Face herkenning', key: 'face_recognition_enabled' },
    { action: 'setAutoConfirm', label: '⚡ Auto-bevestig', key: 'auto_confirm_recognition' },
    { action: 'setBoomerang', label: '🔄 Boomerang GIF', key: 'boomerang_enabled' },
    { action: 'setSendQrEmails', label: '📧 QR emails', key: 'send_qr_emails' },
    { action: 'setSmileShutter', label: '😊 Smile sluiter', key: 'smile_shutter_enabled' },
    { action: 'setArFilters', label: '🎭 AR filters', key: 'ar_filters_enabled' },
    { action: 'setSlideshow', label: '🖼 Slideshow', key: 'slideshow_enabled' },
];

export const LAYOUT_OPTIONS = [
    { id: 'template-1', label: "1\uFE0F\u20E3 E\u00E9n foto" },
    { id: 'template-2', label: "2\uFE0F\u20E3 Twee foto's" },
    { id: 'template-3', label: "3\uFE0F\u20E3 Drie foto's" },
    { id: 'template-4', label: "4\uFE0F\u20E3 Vier foto's" },
];

let _pendingChanges = {};
let _pendingLayouts = null; // null = unchanged, array = pending
let _pendingTimer = null; // null = unchanged, number = pending
let _serverLayouts = [];
let _serverTimer = 60;
let _adminToken = null;

export function setAdminToken(token) {
    _adminToken = token;
}

export function resetPending() {
    _pendingChanges = {};
    _pendingLayouts = null;
    _pendingTimer = null;
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
        const serverVal = ev[t.key] === true;
        const hasPending = Object.prototype.hasOwnProperty.call(_pendingChanges, t.action);
        const effectiveVal = hasPending ? _pendingChanges[t.action] : serverVal;
        const checked = effectiveVal ? 'checked' : '';
        const dirty = hasPending && _pendingChanges[t.action] !== serverVal ? 'dirty' : '';
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

    // ── Layout checkboxes ──────────────────────────────────────────────────────
    _serverLayouts = ev.selectedLayouts ?? [];
    _serverTimer = ev.slideshow_idle_timer ?? 60;
    const effectiveLayouts = _pendingLayouts !== null ? _pendingLayouts : _serverLayouts;
    const layoutsEl = el('adminLayouts');
    if (layoutsEl) {
        layoutsEl.innerHTML = LAYOUT_OPTIONS.map(opt => {
            const isOn = effectiveLayouts.includes(opt.id);
            const dirty = (_pendingLayouts !== null) && (isOn !== _serverLayouts.includes(opt.id)) ? 'dirty' : '';
            return `
        <label class="layout-label ${dirty}">
          <input type="checkbox" value="${opt.id}" ${isOn ? 'checked' : ''}
            onchange="window._adminMarkLayout('${opt.id}', this.checked, '${ev.id}')">
          ${opt.label}
        </label>`;
        }).join('');
    }

    // ── Slideshow idle timer ───────────────────────────────────────────────────
    const effectiveTimer = _pendingTimer !== null ? _pendingTimer : _serverTimer;
    const timerEl = el('slideshowTimer');
    if (timerEl) {
        timerEl.value = effectiveTimer;
        timerEl.dataset.eventId = ev.id;
        timerEl.className = 'timer-input' + (_pendingTimer !== null && _pendingTimer !== _serverTimer ? ' dirty' : '');
    }

    _updateSaveBar();
}

// Called from inline onchange handlers (needs global exposure — done in dashboard.js)
export function markPending(action, value, eventId) {
    _pendingChanges[action] = value;
    _pendingChanges._eventId = eventId;
    _updateSaveBar();
    // Trigger re-render of dirty borders — dashboard.js subscribes via onPendingChange
    window.dispatchEvent(new CustomEvent('admin:pendingChanged'));
}

export function markLayoutPending(layoutId, enabled, eventId) {
    const base = _pendingLayouts !== null ? _pendingLayouts : _serverLayouts;
    _pendingLayouts = enabled
        ? [...new Set([...base, layoutId])]
        : base.filter(id => id !== layoutId);
    _pendingChanges._eventId = eventId;
    _updateSaveBar();
    window.dispatchEvent(new CustomEvent('admin:pendingChanged'));
}

export function markTimerPending(seconds, eventId) {
    _pendingTimer = Number(seconds);
    _pendingChanges._eventId = eventId;
    _updateSaveBar();
    window.dispatchEvent(new CustomEvent('admin:pendingChanged'));
}

function _updateSaveBar() {
    const toggleCount = Object.keys(_pendingChanges).filter(k => k !== '_eventId').length;
    const layoutsDirty = _pendingLayouts !== null;
    const timerDirty = _pendingTimer !== null;
    const count = toggleCount + (layoutsDirty ? 1 : 0) + (timerDirty ? 1 : 0);
    const btn = el('saveBtn');
    const cnt = el('pendingCount');
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
    const hasLayouts = _pendingLayouts !== null;
    const hasTimer = _pendingTimer !== null;
    if (!actions.length && !hasLayouts && !hasTimer) return;
    if (!eventId || !_adminToken) return;

    const btn = el('saveBtn');
    btn.disabled = true;
    btn.textContent = 'Opslaan…';

    let allOk = true;
    for (const action of actions) {
        try {
            const d = await sendCommand(_adminToken, { eventId, action, value: _pendingChanges[action] });
            if (!d.ok) { allOk = false; console.warn('[admin] command rejected:', d.error); }
        } catch (err) {
            allOk = false;
            console.error('[admin] sendCommand failed:', err.message);
        }
    }

    if (hasLayouts) {
        try {
            const d = await sendCommand(_adminToken, { eventId, action: 'setLayouts', value: _pendingLayouts.join(',') });
            if (!d.ok) { allOk = false; console.warn('[admin] setLayouts rejected:', d.error); }
        } catch (err) {
            allOk = false;
            console.error('[admin] setLayouts failed:', err.message);
        }
    }

    if (hasTimer) {
        try {
            const d = await sendCommand(_adminToken, { eventId, action: 'setSlideshowIdleTimer', value: _pendingTimer });
            if (!d.ok) { allOk = false; console.warn('[admin] setSlideshowIdleTimer rejected:', d.error); }
        } catch (err) {
            allOk = false;
            console.error('[admin] setSlideshowIdleTimer failed:', err.message);
        }
    }

    _pendingChanges = {};
    _pendingLayouts = null;
    _pendingTimer = null;
    btn.disabled = false;
    btn.textContent = '💾 Opslaan';
    btn.classList.remove('has-changes');
    el('pendingCount').textContent = '';

    const fb = el('saveFeedback');
    fb.textContent = allOk ? '✅ Opgeslagen!' : '⚠ Gedeeltelijk opgeslagen';
    fb.style.color = allOk ? 'var(--green)' : 'var(--orange)';
    fb.style.display = 'inline';
    setTimeout(() => { fb.style.display = 'none'; }, 3000);
}
