/**
 * login.js — Login flow for event.datuur.be
 *
 * Same credentials as status.datuur.be (shared ADMIN_PASSWORD + TOTP_SECRET).
 * On success stores adminToken in localStorage and redirects to /event/.
 */

const TOKEN_KEY = 'adminToken';

// ── If already logged in, verify and skip to event page ──────────────────────
const stored = localStorage.getItem(TOKEN_KEY);
if (stored) {
    fetch('/api/admin/verify', {
        headers: { 'X-Admin-Token': stored },
        cache: 'no-store',
    })
        .then(r => r.json())
        .then(d => { if (d.ok) window.location.replace('/event/'); })
        .catch(() => { /* offline — stay on login page */ });
}

// ── State ─────────────────────────────────────────────────────────────────────
let _password = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function showErr(msg) {
    const el = document.getElementById('loginErr');
    el.textContent = msg;
    el.hidden = false;
}

function hideErr() {
    document.getElementById('loginErr').hidden = true;
}

// ── Step 1: password ──────────────────────────────────────────────────────────
window._doLogin = async () => {
    const pw = document.getElementById('pwInput').value.trim();
    if (!pw) return;
    hideErr();

    try {
        const r = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw }),
            cache: 'no-store',
        });
        const d = await r.json();

        if (d.ok && d.token) {
            localStorage.setItem(TOKEN_KEY, d.token);
            window.location.replace('/event/');
        } else if (d.needsTotp) {
            _password = pw;
            document.getElementById('step1').hidden = true;
            document.getElementById('step2').hidden = false;
            setTimeout(() => document.getElementById('totpInput').focus(), 50);
        } else {
            showErr(d.error || 'Wachtwoord onjuist.');
        }
    } catch {
        showErr('Kan niet verbinden met de server.');
    }
};

// ── Step 2: TOTP ──────────────────────────────────────────────────────────────
window._doTotp = async () => {
    const code = document.getElementById('totpInput').value.replace(/\s/g, '');
    if (code.length !== 6) return;
    hideErr();

    try {
        const r = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: _password, totpCode: code }),
            cache: 'no-store',
        });
        const d = await r.json();

        if (d.ok && d.token) {
            localStorage.setItem(TOKEN_KEY, d.token);
            window.location.replace('/event/');
        } else {
            showErr(d.error || 'Ongeldige authenticatiecode.');
            document.getElementById('totpInput').value = '';
            setTimeout(() => document.getElementById('totpInput').focus(), 50);
        }
    } catch {
        showErr('Kan niet verbinden met de server.');
    }
};

// ── Back to step 1 ─────────────────────────────────────────────────────────────
window._backToStep1 = () => {
    document.getElementById('step1').hidden = false;
    document.getElementById('step2').hidden = true;
    document.getElementById('totpInput').value = '';
    _password = null;
    hideErr();
};
