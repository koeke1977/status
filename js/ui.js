/**
 * ui.js — pure DOM rendering helpers, no fetch calls
 * All functions receive plain data objects and update the DOM.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

export function el(id) { return document.getElementById(id); }

export function fmtUptime(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}u ${m}m`;
}

export function timeAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s geleden`;
  if (s < 3600) return `${Math.floor(s / 60)}m geleden`;
  return `${Math.floor(s / 3600)}u geleden`;
}

// ── Status pill ───────────────────────────────────────────────────────────────

export function renderStatusPill(data) {
  const online    = data.online !== false;
  const overall   = data.health?.overall;
  const pillClass = online
    ? (overall === 'healthy' ? 'pill-online' : 'pill-offline')
    : 'pill-offline';
  const pillLabel = online
    ? (overall === 'healthy' ? 'Online — gezond' : `Online — ${overall}`)
    : 'Offline';
  el('statusPill').innerHTML = `
    <div class="status-pill ${pillClass}">
      <span class="dot"></span>${pillLabel}
    </div>`;
  el('lastPing').textContent = data.timestamp
    ? `Laatste ping: ${timeAgo(data.timestamp)}`
    : '';
}

// ── Offline banner ────────────────────────────────────────────────────────────

export function setOfflineBanner(visible, message) {
  const banner = el('offlineBanner');
  banner.style.display = visible ? 'block' : 'none';
  if (message) banner.textContent = message;
}

// ── Active event ──────────────────────────────────────────────────────────────

export function renderActiveEvent(data) {
  el('activeEventName').textContent  = data.activeEvent?.name ?? '(geen)';
  el('photosToday').textContent      = data.photosToday != null ? `${data.photosToday} foto's vandaag` : '';
  const uCount = data.activeEvent?.userCount;
  el('eventUserCount').textContent   = uCount != null
    ? `${uCount} gebruiker${uCount !== 1 ? 's' : ''} gekoppeld`
    : '';
  const hosts = data.activeEvent?.partyHosts ?? [];
  el('eventPartyHosts').textContent  = hosts.length ? `🎉 ${hosts.join(' · ')}` : '';
}

// ── Stat cards (photos + herkenning) ─────────────────────────────────────────

export function renderStatCards(data) {
  const photos    = data.photosToday ?? '—';
  const analytics = data.analytics   ?? {};

  el('statPhotos').textContent    = photos;
  el('statGuests').textContent    = analytics.uniqueGuests ?? '—';
  el('statRecognition').textContent = analytics.recognitionRate != null
    ? `${analytics.recognitionRate}%`
    : '—';
  el('statUptime').textContent    = fmtUptime(data.uptime);
  el('statUptimeSince').textContent = data.startTime
    ? `Sinds ${new Date(data.startTime).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`
    : '';
}

// ── System info ───────────────────────────────────────────────────────────────

export function renderInfoRow(data) {
  const cells = [
    { label: 'Booth ID',  value: data.boothId    ?? '—' },
    { label: 'Versie',    value: data.appVersion ?? '—' },
    { label: 'Platform',  value: data.platform   ?? '—' },
    { label: 'Uptime',    value: fmtUptime(data.uptime) },
  ];
  el('infoRow').innerHTML = cells.map(c => `
    <div class="info-cell">
      <div class="ic-label">${c.label}</div>
      <div class="ic-value">${c.value}</div>
    </div>`).join('');
}

// ── Memory bar ────────────────────────────────────────────────────────────────

export function renderMemoryBar(data) {
  const mem   = data.memory ?? {};
  const used  = parseFloat(mem.heapUsedMB)  || 0;
  const total = parseFloat(mem.heapTotalMB) || 0;
  const pct   = total > 0 ? Math.min(100, (used / total) * 100) : 0;

  el('memUsed').textContent  = `Gebruikt: ${used  ? Math.round(used)  + ' MB' : '—'}`;
  el('memTotal').textContent = `Totaal heap: ${total ? Math.round(total) + ' MB' : '—'}`;
  const fill = el('memBarFill');
  fill.style.width  = `${pct}%`;
  fill.className    = 'mem-bar-fill' + (pct > 80 ? ' crit' : pct > 60 ? ' warn' : '');
}

// ── Services ──────────────────────────────────────────────────────────────────

const SVC_ICONS = {
  'Camera':  '📷',
  'Printer': '🖨',
  'Face AI': '🎯',
  'Email':   '✉',
};

export function renderServices(data) {
  const services = data.health?.services ?? [];
  el('servicesGrid').innerHTML = services.map(s => `
    <div class="service-card border-${s.status}">
      <div class="svc-icon">${SVC_ICONS[s.name] ?? '⚙'}</div>
      <div class="svc-name">${s.name}</div>
      <div class="svc-status st-${s.status}">
        <span>${s.status === 'healthy' ? '✅' : s.status === 'degraded' ? '🟡' : '❌'}</span>
        ${s.status.charAt(0).toUpperCase() + s.status.slice(1)}
      </div>
      <div class="svc-meta">${s.stats?.operations ?? 0} ops · ${s.stats?.avgResponseTime ?? 0} ms avg</div>
      ${s.stats?.errorRate ? `<div class="svc-meta">Fouten: ${s.stats.errorRate}</div>` : ''}
    </div>`).join('')
    || '<div style="color:var(--muted);font-size:.82rem">Geen servicedata</div>';
}

// ── Recent errors ─────────────────────────────────────────────────────────────

export function renderErrors(data) {
  const services = data.health?.services ?? [];
  const errors   = services
    .flatMap(s => (s.recentErrors ?? []).map(e => ({ ...e, service: s.name })))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 8);

  const section = el('errorsSection');
  section.style.display = errors.length ? 'block' : 'none';
  el('errorsList').innerHTML = errors.map(e => `
    <div class="error-row">
      <div class="err-header">
        <span class="err-svc">${e.service}:</span>
        <span class="err-op">${e.operation ?? ''}</span>
      </div>
      <div class="err-msg">${e.message}</div>
      <div class="err-time">${e.timestamp ? timeAgo(e.timestamp) : ''}</div>
    </div>`).join('');
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

export function renderSparkline(history) {
  const svg = el('sparkline');
  if (!history || history.length < 2) {
    svg.innerHTML = '<text x="50%" y="50%" fill="#555" font-size="11" text-anchor="middle">Geen geschiedenis</text>';
    return;
  }
  const values = history.map(h => h.heapMB ?? 0);
  const max    = Math.max(...values, 1);
  const w = 400, h = 70, pad = 4;
  const xs = values.map((_, i) => pad + (i / (values.length - 1)) * (w - pad * 2));
  const ys = values.map(v => h - pad - ((v / max) * (h - pad * 2)));
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(' ');

  // Grid lines
  const gridLines = [0.25, 0.5, 0.75].map(f => {
    const y = h - pad - f * (h - pad * 2);
    return `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="#2a2a2a" stroke-width="1"/>`;
  }).join('');

  // Fill
  const fillPts = `${xs[0]},${h} ` + pts + ` ${xs[xs.length - 1]},${h}`;

  svg.innerHTML = `
    ${gridLines}
    <polygon points="${fillPts}" fill="rgba(59,130,246,0.12)" />
    <polyline points="${pts}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

  // Peak label
  const peakMB = Math.round(max);
  el('sparklinePeak').textContent = `Piek: ${peakMB} MB`;
}

// ── Features overview ─────────────────────────────────────────────────────────

export function renderFeaturesOverview(data, adminToggles) {
  const ov = el('featuresOverview');
  if (!ov) return;
  const ev = data.activeEvent;
  if (!ev) {
    ov.innerHTML = '<div style="color:var(--muted);font-size:.82rem">Geen actief evenement</div>';
    return;
  }
  ov.innerHTML = adminToggles.map(t => {
    const on = ev[t.key] === true;
    return `<div class="feat-badge ${on ? 'feat-on' : 'feat-off'}">
      <span class="feat-icon">${t.label}</span>
      <span class="feat-state">${on ? 'AAN' : 'UIT'}</span>
    </div>`;
  }).join('');
}

// ── Timestamp ─────────────────────────────────────────────────────────────────

export function updateTimestamp() {
  el('lastUpdated').textContent =
    `Laatste update: ${new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`;
}
