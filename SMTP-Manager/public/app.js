/* ═══════════════════════════════════════════════════════════════
   SMTP Manager — Frontend SPA
   ═══════════════════════════════════════════════════════════════ */

// ── API Client ──────────────────────────────────────────────────
const api = {
  async req(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get:    (p)    => api.req('GET',    p, null),
  post:   (p, b) => api.req('POST',   p, b),
  put:    (p, b) => api.req('PUT',    p, b),
  delete: (p)    => api.req('DELETE', p, null),
};

// ── State ────────────────────────────────────────────────────────
let state = { sites: [], alerts: [] };

// ── Utilities ────────────────────────────────────────────────────
function fmt(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d)) return ts;
  return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function ago(ts) {
  if (!ts) return 'Never';
  const sec = Math.floor(Date.now()/1000) - ts;
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
  if (sec < 86400)return `${Math.floor(sec/3600)}h ago`;
  return `${Math.floor(sec/86400)}d ago`;
}
function statusBadge(s) {
  const map = { online:'badge-online', offline:'badge-offline', unknown:'badge-unknown' };
  const lbl = { online:'Online', offline:'Offline', unknown:'Unknown' };
  return `<span class="badge ${map[s]||'badge-unknown'}">${lbl[s]||s}</span>`;
}
function domainInitial(name) {
  return (name || '?').substring(0, 2).toUpperCase();
}
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toast ────────────────────────────────────────────────────────
const toastIcons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
function toast(msg, type = 'info', dur = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${toastIcons[type]}</span><span>${esc(msg)}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, dur);
}

// ── Modal ────────────────────────────────────────────────────────
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('show');
}
document.getElementById('modal-overlay').addEventListener('click', closeModal);

// ── Page render ──────────────────────────────────────────────────
function renderPage(html) {
  const page = document.getElementById('page');
  page.classList.remove('page-enter');
  void page.offsetWidth; // reflow
  page.innerHTML = html;
  page.classList.add('page-enter');
}
function setActiveNav(id) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById('nav-' + id);
  if (el) el.classList.add('active');
}

// ── Router ───────────────────────────────────────────────────────
function router() {
  const hash = (window.location.hash || '#/dashboard').replace('#/', '').split('/');
  const page = hash[0] || 'dashboard';
  const id   = hash[1];

  if      (page === 'dashboard')           renderDashboard();
  else if (page === 'sites')               renderSites();
  else if (page === 'site' && id)          renderSiteDetail(id);
  else if (page === 'alerts')              renderAlerts();
  else if (page === 'updates')             renderUpdates();
  else if (page === 'settings')            renderSettings();
  else                                     renderDashboard();
}
window.addEventListener('hashchange', router);
window.addEventListener('load', () => { router(); refreshSidebar(); });

// ── Sidebar refresh ──────────────────────────────────────────────
async function refreshSidebar() {
  try {
    const stats = await api.get('/dashboard/stats');
    document.getElementById('sb-online').textContent  = `${stats.online}  Online`;
    document.getElementById('sb-offline').textContent = `${stats.offline} Offline`;
    document.getElementById('sb-unknown').textContent = `${stats.unknown} Unknown`;
    document.getElementById('sites-count').textContent = stats.total;
    const ab = document.getElementById('alerts-count');
    if (stats.alerts > 0) {
      ab.textContent = stats.alerts;
      ab.style.display = '';
    } else {
      ab.style.display = 'none';
    }
  } catch(_) {}
}

// ══════════════════════════════════════
// DASHBOARD PAGE
// ══════════════════════════════════════
async function renderDashboard() {
  setActiveNav('dashboard');
  renderPage(`
    <div class="page-header">
      <div class="page-header-left">
        <h1>Dashboard</h1>
        <p>Overview of all your WordPress sites and SMTP health</p>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary" onclick="pingAllSites()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          Ping All
        </button>
        <button class="btn btn-primary" onclick="window.location.hash='#/sites'">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Site
        </button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="stat-icon">🌐</div>
        <div class="stat-value" id="stat-total">—</div>
        <div class="stat-label">Total Sites</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon">✅</div>
        <div class="stat-value" id="stat-online">—</div>
        <div class="stat-label">Online Sites</div>
      </div>
      <div class="stat-card red">
        <div class="stat-icon">🔴</div>
        <div class="stat-value" id="stat-offline">—</div>
        <div class="stat-label">Offline / Failed</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-icon">⚠️</div>
        <div class="stat-value" id="stat-unknown">—</div>
        <div class="stat-label">Not Checked</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-icon">🔔</div>
        <div class="stat-value" id="stat-alerts">—</div>
        <div class="stat-label">Active Alerts</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:28px">
      <div class="card-header">
        <div>
          <div class="card-title">Sites Health Map</div>
          <div class="card-subtitle">Click any site to manage it</div>
        </div>
        <div class="search-bar" style="width:240px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="dash-search" placeholder="Search sites..." oninput="filterSiteCards(this.value)" />
        </div>
      </div>
      <div class="card-body">
        <div class="sites-grid" id="sites-grid">
          <div class="skeleton" style="height:140px;border-radius:14px"></div>
          <div class="skeleton" style="height:140px;border-radius:14px"></div>
          <div class="skeleton" style="height:140px;border-radius:14px"></div>
        </div>
      </div>
    </div>
  `);

  // Load stats
  try {
    const s = await api.get('/dashboard/stats');
    document.getElementById('stat-total').textContent   = s.total;
    document.getElementById('stat-online').textContent  = s.online;
    document.getElementById('stat-offline').textContent = s.offline;
    document.getElementById('stat-unknown').textContent = s.unknown;
    document.getElementById('stat-alerts').textContent  = s.alerts;
  } catch(_) {}

  // Load sites grid
  try {
    const sites = await api.get('/sites');
    state.sites = sites;
    renderSiteCards(sites);
  } catch(_) {
    document.getElementById('sites-grid').innerHTML = '<p style="color:var(--text3)">Failed to load sites.</p>';
  }
}

function renderSiteCards(sites) {
  const grid = document.getElementById('sites-grid');
  if (!grid) return;
  if (!sites.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-state-icon">🌐</div>
        <h3>No Sites Added Yet</h3>
        <p>Add your first WordPress site to start managing it</p>
        <br>
        <button class="btn btn-primary" onclick="window.location.hash='#/sites'">Add Your First Site</button>
      </div>`;
    return;
  }
  grid.innerHTML = sites.map(s => `
    <div class="site-card" onclick="window.location.hash='#/site/${s.id}'">
      <div class="site-card-header">
        <div>
          <div class="site-card-name">${esc(s.name)}</div>
          <div class="site-card-url">${esc(s.url || s.agent_url)}</div>
        </div>
        ${statusBadge(s.status)}
      </div>
      <div class="site-card-meta">
        <div class="site-card-meta-item">
          <div class="label">Last Ping</div>
          <div class="value">${ago(s.last_ping)}</div>
        </div>
        <div class="site-card-meta-item" style="text-align:right">
          <div class="label">Action</div>
          <div class="value" style="color:var(--accent)">Manage →</div>
        </div>
      </div>
    </div>
  `).join('');
}

function filterSiteCards(q) {
  const filtered = state.sites.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    (s.url||'').toLowerCase().includes(q.toLowerCase())
  );
  renderSiteCards(filtered);
}

// ══════════════════════════════════════
// SITES LIST PAGE
// ══════════════════════════════════════
async function renderSites() {
  setActiveNav('sites');
  renderPage(`
    <div class="page-header">
      <div class="page-header-left">
        <h1>Sites</h1>
        <p>Manage all your WordPress sites with SMTP Fallback Plugin</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="search-bar" style="width:220px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="sites-search" placeholder="Search..." oninput="filterSitesTable(this.value)" />
        </div>
        <button class="btn btn-secondary" onclick="showImportModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
          Import
        </button>
        <button class="btn btn-primary" onclick="showAddSiteModal()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Site
        </button>
      </div>
    </div>

    <div class="table-wrap">
      <table id="sites-table">
        <thead>
          <tr>
            <th>Site Name</th>
            <th>URL</th>
            <th>Status</th>
            <th>Last Ping</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="sites-tbody">
          <tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text3)">
            <div class="loading-spinner" style="margin:0 auto"></div>
          </td></tr>
        </tbody>
      </table>
    </div>
  `);
  await loadSitesTable();
}

async function loadSitesTable() {
  try {
    const sites = await api.get('/sites');
    state.sites = sites;
    renderSitesTable(sites);
    refreshSidebar();
  } catch(e) {
    document.getElementById('sites-tbody').innerHTML =
      `<tr><td colspan="6" style="text-align:center;color:var(--red);padding:30px">${esc(e.message)}</td></tr>`;
  }
}

function renderSitesTable(sites) {
  const tbody = document.getElementById('sites-tbody');
  if (!tbody) return;
  if (!sites.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-state-icon">🌐</div>
        <h3>No Sites Yet</h3>
        <p>Click "Add Site" to register your first WordPress site</p>
      </div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = sites.map(s => `
    <tr>
      <td style="font-weight:700">${esc(s.name)}</td>
      <td><a href="${esc(s.url||s.agent_url)}" target="_blank" style="color:var(--accent)">${esc(s.url||'—')}</a></td>
      <td>${statusBadge(s.status)}</td>
      <td>${ago(s.last_ping)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.notes||'—')}</td>
      <td>
        <div class="td-actions">
          <button class="btn btn-sm btn-secondary" onclick="pingSite(${s.id},this)" title="Ping">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn btn-sm btn-secondary" onclick="window.location.hash='#/site/${s.id}'" title="Manage">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          </button>
          <button class="btn btn-sm btn-secondary" onclick="showEditSiteModal(${s.id})" title="Edit">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn btn-sm btn-danger" onclick="confirmDeleteSite(${s.id},'${esc(s.name)}')" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterSitesTable(q) {
  const filtered = state.sites.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    (s.url||'').toLowerCase().includes(q.toLowerCase()) ||
    (s.notes||'').toLowerCase().includes(q.toLowerCase())
  );
  renderSitesTable(filtered);
}

// Add Site Modal
async function showAddSiteModal(prefill = {}) {
  const res = await api.get('/generate-token').catch(() => ({ token: '' }));
  openModal(`
    <div class="modal-header">
      <h2>➕ Add New Site</h2>
      <p>Register a WordPress site running the SMTP Fallback Plugin</p>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Site Name <span>*</span></label>
        <input id="add-name" class="form-input" placeholder="My Client Site" value="${esc(prefill.name||'')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Site URL <span>*</span></label>
        <input id="add-url" class="form-input" placeholder="https://example.com" value="${esc(prefill.url||'')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Agent URL <span>*</span></label>
        <input id="add-agent-url" class="form-input" placeholder="https://example.com/wp-content/plugins/SMTP Plugin/smtp-agent.php" value="${esc(prefill.agent_url||'')}" />
        <div class="form-hint">Full URL to the smtp-agent.php file on this WordPress site</div>
      </div>
      <div class="form-group">
        <label class="form-label">API Token <span>*</span></label>
        <div class="token-box">
          <span id="add-token-val" style="flex:1;word-break:break-all;font-size:12px">${esc(prefill.api_token || res.token)}</span>
          <button class="btn btn-sm btn-secondary" onclick="regenerateToken()">Regenerate</button>
        </div>
        <div class="form-hint">Copy this token and paste it into smtp-agent.php on the WordPress site</div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea id="add-notes" class="form-textarea" placeholder="Client name, admin contact...">${esc(prefill.notes||'')}</textarea>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:8px">
        <div class="section-label" style="margin-bottom:12px">📋 Setup Instructions</div>
        <ol style="color:var(--text2);font-size:13px;line-height:1.9;padding-left:18px">
          <li>Copy <code style="color:var(--accent)">smtp-agent.php</code> into the plugin folder on the WordPress site</li>
          <li>Open <code style="color:var(--accent)">smtp-agent.php</code> and set the token shown above</li>
          <li>Click "Add Site" below and then click Ping to verify</li>
        </ol>
      </div>
    </div>
    <div class="modal-footer" style="justify-content:space-between">
      <button class="btn btn-green" id="dl-agent-btn" onclick="downloadAgentFromModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download Agent File
      </button>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.remove('show')">Cancel</button>
        <button class="btn btn-primary" onclick="submitAddSite()">Add Site</button>
      </div>
    </div>
  `);
}

function downloadAgentFromModal() {
  const token = document.getElementById('add-token-val')?.textContent?.trim();
  if (!token || token === 'YOUR_SECRET_TOKEN_HERE') return toast('Generate a token first', 'warning');
  downloadAgentFile(token);
}

async function regenerateToken() {
  const res = await api.get('/generate-token').catch(() => null);
  if (res) document.getElementById('add-token-val').textContent = res.token;
}

async function submitAddSite() {
  const name      = document.getElementById('add-name').value.trim();
  const url       = document.getElementById('add-url').value.trim();
  const agent_url = document.getElementById('add-agent-url').value.trim();
  const api_token = document.getElementById('add-token-val').textContent.trim();
  const notes     = document.getElementById('add-notes').value.trim();
  if (!name || !agent_url || !api_token) return toast('Name, Agent URL, and token are required', 'error');
  try {
    await api.post('/sites', { name, url, agent_url, api_token, notes });
    toast(`Site "${name}" added!`, 'success');
    document.getElementById('modal-overlay').classList.remove('show');
    await loadSitesTable();
    refreshSidebar();
  } catch(e) { toast(e.message, 'error'); }
}

// Edit Site Modal
async function showEditSiteModal(id) {
  const site = state.sites.find(s => s.id === id);
  if (!site) return;
  openModal(`
    <div class="modal-header">
      <h2>✏️ Edit Site</h2>
      <p>${esc(site.name)}</p>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Site Name</label>
        <input id="edit-name" class="form-input" value="${esc(site.name)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Site URL</label>
        <input id="edit-url" class="form-input" value="${esc(site.url||'')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Agent URL</label>
        <input id="edit-agent-url" class="form-input" value="${esc(site.agent_url)}" />
      </div>
      <div class="form-group">
        <label class="form-label">API Token</label>
        <input id="edit-token" class="form-input" value="${esc(site.api_token)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea id="edit-notes" class="form-textarea">${esc(site.notes||'')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.remove('show')">Cancel</button>
      <button class="btn btn-primary" onclick="submitEditSite(${id})">Save Changes</button>
    </div>
  `);
}

async function submitEditSite(id) {
  const body = {
    name:      document.getElementById('edit-name').value.trim(),
    url:       document.getElementById('edit-url').value.trim(),
    agent_url: document.getElementById('edit-agent-url').value.trim(),
    api_token: document.getElementById('edit-token').value.trim(),
    notes:     document.getElementById('edit-notes').value.trim(),
  };
  try {
    await api.put(`/sites/${id}`, body);
    toast('Site updated!', 'success');
    document.getElementById('modal-overlay').classList.remove('show');
    await loadSitesTable();
  } catch(e) { toast(e.message, 'error'); }
}

function confirmDeleteSite(id, name) {
  openModal(`
    <div class="modal-header">
      <h2>🗑️ Delete Site</h2>
      <p>This action cannot be undone</p>
    </div>
    <div class="modal-body">
      <p style="color:var(--text2)">Are you sure you want to remove <strong style="color:var(--text)">${esc(name)}</strong> from the dashboard?</p>
      <p style="color:var(--text3);font-size:13px;margin-top:10px">This only removes it from the manager. The plugin on the site will not be affected.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.remove('show')">Cancel</button>
      <button class="btn btn-danger" onclick="deleteSite(${id})">Delete Site</button>
    </div>
  `);
}

async function deleteSite(id) {
  try {
    await api.delete(`/sites/${id}`);
    toast('Site removed', 'info');
    document.getElementById('modal-overlay').classList.remove('show');
    await loadSitesTable();
    refreshSidebar();
  } catch(e) { toast(e.message, 'error'); }
}

// Ping helpers
async function pingSite(id, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="loading-spinner"></div>'; }
  try {
    const r = await api.post(`/sites/${id}/ping`);
    toast(r.status === 'online' ? `✅ Site is online!` : `❌ Site offline: ${r.error}`, r.status === 'online' ? 'success' : 'error');
    await loadSitesTable();
    refreshSidebar();
  } catch(e) { toast(e.message, 'error'); }
  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'; }
}

async function pingAllSites() {
  toast('Pinging all sites...', 'info', 2000);
  try {
    const results = await api.post('/sites/ping-all');
    const online  = results.filter(r => r.status === 'online').length;
    const offline = results.filter(r => r.status !== 'online').length;
    toast(`✅ ${online} online, ❌ ${offline} offline`, 'info', 5000);
    await loadSitesTable().catch(()=>{});
    await renderDashboard().catch(()=>{});
    refreshSidebar();
  } catch(e) { toast(e.message, 'error'); }
}

// Import CSV Modal
function showImportModal() {
  openModal(`
    <div class="modal-header">
      <h2>📥 Bulk Import Sites</h2>
      <p>Import multiple sites at once from CSV</p>
    </div>
    <div class="modal-body">
      <p style="color:var(--text2);font-size:14px;margin-bottom:16px">Paste CSV data with columns: <code style="color:var(--accent)">name, url, agent_url, api_token, notes</code></p>
      <textarea id="import-csv" class="form-textarea" style="min-height:160px;font-family:monospace;font-size:12px"
        placeholder="My Site, https://example.com, https://example.com/wp-content/plugins/SMTP Plugin/smtp-agent.php, mytoken123, Notes here
Second Site, https://site2.com, https://site2.com/wp-content/plugins/SMTP Plugin/smtp-agent.php, token456,"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.remove('show')">Cancel</button>
      <button class="btn btn-primary" onclick="submitImport()">Import Sites</button>
    </div>
  `);
}

async function submitImport() {
  const csv = document.getElementById('import-csv').value.trim();
  const lines = csv.split('\n').filter(l => l.trim());
  let added = 0, failed = 0;
  for (const line of lines) {
    const [name, url, agent_url, api_token, ...notesParts] = line.split(',').map(s => s.trim());
    if (!name || !agent_url || !api_token) { failed++; continue; }
    try {
      await api.post('/sites', { name, url: url||'', agent_url, api_token, notes: notesParts.join(',') });
      added++;
    } catch(_) { failed++; }
  }
  toast(`Imported ${added} sites${failed ? `, ${failed} failed` : ''}`, added > 0 ? 'success' : 'error');
  document.getElementById('modal-overlay').classList.remove('show');
  await loadSitesTable();
  refreshSidebar();
}

// ══════════════════════════════════════
// SITE DETAIL PAGE
// ══════════════════════════════════════
let currentSite = null;
let activeTab = 'overview';

async function renderSiteDetail(id) {
  setActiveNav('sites');

  // Load site from state or fetch
  currentSite = state.sites.find(s => s.id == id);
  if (!currentSite) {
    try {
      const sites = await api.get('/sites');
      state.sites = sites;
      currentSite = sites.find(s => s.id == id);
    } catch(_) {}
  }
  if (!currentSite) { toast('Site not found', 'error'); window.location.hash = '#/sites'; return; }

  renderPage(`
    <div style="margin-bottom:24px">
      <a href="#/sites" style="color:var(--text3);font-size:13px;display:inline-flex;align-items:center;gap:6px;margin-bottom:20px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Sites
      </a>
      <div class="detail-header">
        <div class="detail-avatar">${domainInitial(currentSite.name)}</div>
        <div class="detail-info">
          <h1>${esc(currentSite.name)}</h1>
          <p>${esc(currentSite.url || currentSite.agent_url)}</p>
          <div style="margin-top:8px">${statusBadge(currentSite.status)}</div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary" onclick="pingOneSite(${currentSite.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Ping
          </button>
          <button class="btn btn-secondary" onclick="downloadAgentFile('${currentSite.api_token}')" title="Download smtp-agent.php with this site's token pre-filled">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            ↓ Agent File
          </button>
          <button class="btn btn-green" onclick="showTestEmailModal(${currentSite.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Test Email
          </button>
          <button class="btn btn-secondary" onclick="showEditSiteModal(${currentSite.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Edit
          </button>
        </div>
      </div>
    </div>

    <div class="tabs">
      <div class="tab active" id="tab-overview"     onclick="switchTab('overview')">📊 Overview</div>
      <div class="tab" id="tab-smtp"       onclick="switchTab('smtp')">⚙️ SMTP Settings</div>
      <div class="tab" id="tab-logs"       onclick="switchTab('logs')">📋 Logs</div>
      <div class="tab" id="tab-submissions"onclick="switchTab('submissions')">📥 CF7 Submissions</div>
    </div>

    <div id="tab-content">
      <div class="loading-spinner" style="margin:40px auto"></div>
    </div>
  `);

  switchTab('overview');
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const el = document.getElementById('tab-' + tab);
  if (el) el.classList.add('active');

  const content = document.getElementById('tab-content');
  if (!content) return;

  if      (tab === 'overview')     loadTabOverview(content);
  else if (tab === 'smtp')         loadTabSmtp(content);
  else if (tab === 'logs')         loadTabLogs(content);
  else if (tab === 'submissions')  loadTabSubmissions(content);
}

async function loadTabOverview(container) {
  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';
  try {
    const s = await api.get(`/sites/${currentSite.id}/status`);
    container.innerHTML = `
      ${s._cached ? `<div class="badge badge-warning" style="margin-bottom:16px;width:fit-content">⚠️ Showing cached data — site is offline</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div class="card">
          <div class="card-header"><div class="card-title">📡 Primary SMTP</div></div>
          <div class="card-body">
            <div class="smtp-info-grid">
              <div class="smtp-info-item"><div class="label">Host</div><div class="val">${esc(s.primary_smtp?.host||'—')}</div></div>
              <div class="smtp-info-item"><div class="label">Port</div><div class="val">${esc(s.primary_smtp?.port||'—')}</div></div>
              <div class="smtp-info-item"><div class="label">Username</div><div class="val">${esc(s.primary_smtp?.username||'—')}</div></div>
              <div class="smtp-info-item"><div class="label">Encryption</div><div class="val">${esc((s.primary_smtp?.encryption||'—').toUpperCase())}</div></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🔄 Fallback SMTP</div></div>
          <div class="card-body">
            <div class="smtp-info-grid">
              <div class="smtp-info-item"><div class="label">Host</div><div class="val">${esc(s.fallback_smtp?.host||'—')}</div></div>
              <div class="smtp-info-item"><div class="label">Port</div><div class="val">${esc(s.fallback_smtp?.port||'—')}</div></div>
              <div class="smtp-info-item"><div class="label">Username</div><div class="val">${esc(s.fallback_smtp?.username||'—')}</div></div>
              <div class="smtp-info-item"><div class="label">Encryption</div><div class="val">${esc((s.fallback_smtp?.encryption||'—').toUpperCase())}</div></div>
            </div>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
        <div class="stat-card blue">
          <div class="stat-icon">🌐</div>
          <div class="stat-value" style="font-size:22px">${esc(s.wp_version||'—')}</div>
          <div class="stat-label">WordPress Version</div>
        </div>
        <div class="stat-card purple">
          <div class="stat-icon">🔌</div>
          <div class="stat-value" style="font-size:22px">${esc(s.plugin_version||'—')}</div>
          <div class="stat-label">Plugin Version</div>
        </div>
        <div class="stat-card green">
          <div class="stat-icon">📥</div>
          <div class="stat-value" style="font-size:22px">${s.submission_count||0}</div>
          <div class="stat-label">CF7 Submissions</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-icon">📋</div>
          <div class="stat-value" style="font-size:22px">${s.log_count||0}</div>
          <div class="stat-label">Log Entries</div>
        </div>
      </div>
      <div style="margin-top:20px;display:flex;align-items:center;gap:10px">
        <div class="toggle ${s.smtp_enabled?'on':''}" id="plugin-toggle" onclick="togglePlugin(${currentSite.id}, this)"></div>
        <span style="font-size:14px;color:var(--text2)">SMTP Routing: <strong style="color:${s.smtp_enabled?'var(--green)':'var(--red)'}">${s.smtp_enabled?'Enabled':'Disabled'}</strong></span>
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔌</div><h3>Cannot Reach Site</h3><p>${esc(e.message)}</p><br><button class="btn btn-primary" onclick="pingOneSite(${currentSite.id})">Try Ping</button></div>`;
  }
}

async function loadTabSmtp(container) {
  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';
  try {
    const d = await api.get(`/sites/${currentSite.id}/settings`);
    const s = d.settings || {};
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">⚙️ SMTP Configuration</div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-secondary btn-sm" onclick="loadTabSmtp(document.getElementById('tab-content'))">↺ Reload</button>
            <button class="btn btn-primary" onclick="saveSmtpSettings(${currentSite.id})">💾 Save Settings</button>
          </div>
        </div>
        <div class="card-body">
          <div class="section-label">Primary SMTP Server</div>
          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label">SMTP Host</label>
              <input id="smtp-p-host" class="form-input" placeholder="smtp.gmail.com" value="${esc(s.primary_host||'')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Port</label>
              <input id="smtp-p-port" class="form-input" type="number" placeholder="587" value="${esc(s.primary_port||'587')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Encryption</label>
              <select id="smtp-p-enc" class="form-select">
                <option value="tls" ${(s.primary_encryption||'tls')==='tls'?'selected':''}>TLS</option>
                <option value="ssl" ${s.primary_encryption==='ssl'?'selected':''}>SSL</option>
                <option value="none" ${s.primary_encryption==='none'?'selected':''}>None</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input id="smtp-p-user" class="form-input" placeholder="your@email.com" value="${esc(s.primary_username||'')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input id="smtp-p-pass" class="form-input" type="password" placeholder="••••••••" value="${esc(s.primary_password||'')}" />
            </div>
          </div>

          <div class="section-divider"></div>
          <div class="section-label">Fallback SMTP Server</div>
          <div class="form-row-3">
            <div class="form-group">
              <label class="form-label">SMTP Host</label>
              <input id="smtp-f-host" class="form-input" placeholder="smtp.sendgrid.net" value="${esc(s.fallback_host||'')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Port</label>
              <input id="smtp-f-port" class="form-input" type="number" placeholder="587" value="${esc(s.fallback_port||'587')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Encryption</label>
              <select id="smtp-f-enc" class="form-select">
                <option value="tls" ${(s.fallback_encryption||'tls')==='tls'?'selected':''}>TLS</option>
                <option value="ssl" ${s.fallback_encryption==='ssl'?'selected':''}>SSL</option>
                <option value="none" ${s.fallback_encryption==='none'?'selected':''}>None</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Username</label>
              <input id="smtp-f-user" class="form-input" placeholder="apikey" value="${esc(s.fallback_username||'')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input id="smtp-f-pass" class="form-input" type="password" placeholder="••••••••" value="${esc(s.fallback_password||'')}" />
            </div>
          </div>

          <div class="section-divider"></div>
          <div class="section-label">Advanced Options</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">From Email</label>
              <input id="smtp-from-email" class="form-input" placeholder="noreply@example.com" value="${esc(s.from_email||'')}" />
            </div>
            <div class="form-group">
              <label class="form-label">From Name</label>
              <input id="smtp-from-name" class="form-input" placeholder="My Website" value="${esc(s.from_name||'')}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Max Retries</label>
              <input id="smtp-retries" class="form-input" type="number" min="1" max="10" value="${esc(s.max_retries||'3')}" />
            </div>
            <div class="form-group">
              <label class="form-label">Retry Interval (minutes)</label>
              <input id="smtp-interval" class="form-input" type="number" min="1" max="60" value="${esc(s.retry_interval||'5')}" />
            </div>
          </div>
          <div class="form-group">
            <div class="toggle-wrap">
              <div class="toggle ${s.debug_mode?'on':''}" id="debug-toggle" onclick="this.classList.toggle('on')"></div>
              <span class="form-label" style="margin:0">Enable Debug Mode</span>
            </div>
          </div>
          <div class="form-group">
            <div class="toggle-wrap">
              <div class="toggle ${s.use_fallback_for_all?'on':''}" id="fallback-all-toggle" onclick="this.classList.toggle('on')"></div>
              <span class="form-label" style="margin:0">Use Fallback for All Email Types</span>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚙️</div><h3>Cannot Load Settings</h3><p>${esc(e.message)}</p></div>`;
  }
}

async function saveSmtpSettings(id) {
  const settings = {
    primary_host:        document.getElementById('smtp-p-host')?.value.trim()||'',
    primary_port:        document.getElementById('smtp-p-port')?.value.trim()||'587',
    primary_encryption:  document.getElementById('smtp-p-enc')?.value||'tls',
    primary_username:    document.getElementById('smtp-p-user')?.value.trim()||'',
    primary_password:    document.getElementById('smtp-p-pass')?.value||'',
    fallback_host:       document.getElementById('smtp-f-host')?.value.trim()||'',
    fallback_port:       document.getElementById('smtp-f-port')?.value.trim()||'587',
    fallback_encryption: document.getElementById('smtp-f-enc')?.value||'tls',
    fallback_username:   document.getElementById('smtp-f-user')?.value.trim()||'',
    fallback_password:   document.getElementById('smtp-f-pass')?.value||'',
    from_email:          document.getElementById('smtp-from-email')?.value.trim()||'',
    from_name:           document.getElementById('smtp-from-name')?.value.trim()||'',
    max_retries:         document.getElementById('smtp-retries')?.value||'3',
    retry_interval:      document.getElementById('smtp-interval')?.value||'5',
    debug_mode:          document.getElementById('debug-toggle')?.classList.contains('on')||false,
    use_fallback_for_all:document.getElementById('fallback-all-toggle')?.classList.contains('on')||false,
  };
  try {
    await api.post(`/sites/${id}/settings`, { settings });
    toast('SMTP settings saved successfully!', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function loadTabLogs(container) {
  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';
  try {
    const d = await api.get(`/sites/${currentSite.id}/logs`);
    const logs = d.logs || [];
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">📋 Automation Logs</div>
            <div class="card-subtitle">${logs.length} entries</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="loadTabLogs(document.getElementById('tab-content'))">↺ Refresh</button>
        </div>
        <div class="card-body" style="max-height:500px;overflow-y:auto">
          ${logs.length ? logs.map(l => `
            <div class="log-entry">
              <span class="log-time">${fmt(l.timestamp)}</span>
              <span class="log-msg">${esc(l.message||l.msg||JSON.stringify(l))}</span>
            </div>
          `).join('') : '<div class="empty-state" style="padding:30px 0"><div class="empty-state-icon" style="font-size:32px">📋</div><p>No logs found</p></div>'}
        </div>
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><h3>Cannot Load Logs</h3><p>${esc(e.message)}</p></div>`;
  }
}

async function loadTabSubmissions(container) {
  container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';
  try {
    const d = await api.get(`/sites/${currentSite.id}/submissions`);
    const subs = d.submissions || [];
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Form</th><th>Status</th><th>IP Address</th><th>Submitted At</th></tr>
          </thead>
          <tbody>
            ${subs.length ? subs.map(s => `
              <tr>
                <td style="font-family:monospace;color:var(--text3)">#${s.id}</td>
                <td>${esc(s.form_title||'Form '+s.form_id)}</td>
                <td>${statusBadge(s.status||'unknown')}</td>
                <td style="font-family:monospace;font-size:12px">${esc(s.ip_address||'—')}</td>
                <td>${fmt(s.submission_time)}</td>
              </tr>
            `).join('') : `<tr><td colspan="5"><div class="empty-state" style="padding:30px 0"><div class="empty-state-icon" style="font-size:32px">📥</div><p>No submissions found</p></div></td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📥</div><h3>Cannot Load Submissions</h3><p>${esc(e.message)}</p></div>`;
  }
}

async function pingOneSite(id) {
  toast('Pinging...', 'info', 2000);
  try {
    const r = await api.post(`/sites/${id}/ping`);
    toast(r.status === 'online' ? '✅ Site is online!' : `❌ Offline: ${r.error}`, r.status === 'online' ? 'success' : 'error');
    // Update badge
    const sites = await api.get('/sites');
    state.sites = sites;
    currentSite = sites.find(s => s.id == id);
    refreshSidebar();
  } catch(e) { toast(e.message, 'error'); }
}

async function togglePlugin(id, toggleEl) {
  const on = !toggleEl.classList.contains('on');
  
  // Instantly toggle class in the DOM for immediate, ultra-responsive visual feedback
  toggleEl.classList.toggle('on', on);
  
  // Find the text label next to the toggle and update it locally instantly
  const labelEl = toggleEl.nextElementSibling;
  if (labelEl) {
    labelEl.innerHTML = `SMTP Routing: <strong style="color:${on ? 'var(--green)' : 'var(--red)'}">${on ? 'Enabled' : 'Disabled'}</strong>`;
  }

  try {
    await api.post(`/sites/${id}/toggle`, { enabled: on });
    toast(`SMTP Routing ${on ? 'enabled' : 'disabled'} successfully!`, 'success');
  } catch(e) {
    // Revert visual state gracefully if server/agent toggle request fails
    toggleEl.classList.toggle('on', !on);
    if (labelEl) {
      labelEl.innerHTML = `SMTP Routing: <strong style="color:${!on ? 'var(--green)' : 'var(--red)'}">${!on ? 'Enabled' : 'Disabled'}</strong>`;
    }
    toast(`Failed to toggle SMTP: ${e.message}`, 'error');
  }
}

// Test Email Modal
function showTestEmailModal(id) {
  openModal(`
    <div class="modal-header">
      <h2>📧 Send Test Email</h2>
      <p>Send a test email through this site's SMTP configuration</p>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Send To <span>*</span></label>
        <input id="test-email-to" class="form-input" type="email" placeholder="your@email.com" />
      </div>
      <div id="test-email-result"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').classList.remove('show')">Close</button>
      <button class="btn btn-green" id="send-test-btn" onclick="sendTestEmail(${id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Send Test Email
      </button>
    </div>
  `);
}

async function sendTestEmail(id) {
  const email = document.getElementById('test-email-to').value.trim();
  if (!email) return toast('Please enter an email address', 'error');
  const btn = document.getElementById('send-test-btn');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    const r = await api.post(`/sites/${id}/test-email`, { email });
    document.getElementById('test-email-result').innerHTML =
      `<div class="test-result ${r.success?'success':'error'}">${esc(r.message||'Done')}</div>`;
    if (r.success) toast('Test email sent!', 'success');
    else toast('Test email failed', 'error');
  } catch(e) {
    document.getElementById('test-email-result').innerHTML = `<div class="test-result error">${esc(e.message)}</div>`;
    toast(e.message, 'error');
  }
  btn.disabled = false; btn.textContent = 'Send Again';
}

// ══════════════════════════════════════
// ALERTS PAGE
// ══════════════════════════════════════
async function renderAlerts() {
  setActiveNav('alerts');
  renderPage(`
    <div class="page-header">
      <div class="page-header-left">
        <h1>Alerts</h1>
        <p>SMTP failures and offline site notifications</p>
      </div>
      <button class="btn btn-secondary" onclick="clearResolvedAlerts()">🗑️ Clear Resolved</button>
    </div>
    <div class="table-wrap" id="alerts-table-wrap">
      <div class="loading-spinner" style="margin:40px auto"></div>
    </div>
  `);
  await loadAlerts();
}

async function loadAlerts() {
  try {
    const alerts = await api.get('/alerts');
    state.alerts = alerts;
    const wrap = document.getElementById('alerts-table-wrap');
    if (!wrap) return;
    if (!alerts.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:60px"><div class="empty-state-icon">🔔</div><h3>No Alerts</h3><p>All sites are healthy. Alerts appear here when sites go offline or SMTP fails.</p></div>`;
      return;
    }
    wrap.innerHTML = `
      <table>
        <thead><tr><th>Site</th><th>Type</th><th>Message</th><th>Time</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${alerts.map(a => `
            <tr style="${a.resolved?'opacity:0.45':''}">
              <td>${esc(a.site_name||'Unknown')}</td>
              <td><span class="badge ${a.type==='offline'?'badge-offline':'badge-warning'}">${esc(a.type)}</span></td>
              <td style="max-width:300px">${esc(a.message)}</td>
              <td style="font-size:12px">${fmt(a.created_at)}</td>
              <td>${a.resolved ? '<span class="badge badge-online">Resolved</span>' : '<span class="badge badge-offline">Active</span>'}</td>
              <td>${!a.resolved ? `<button class="btn btn-sm btn-green" onclick="resolveAlert(${a.id})">✓ Resolve</button>` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    refreshSidebar();
  } catch(e) { toast(e.message, 'error'); }
}

async function resolveAlert(id) {
  try {
    await api.put(`/alerts/${id}/resolve`);
    toast('Alert resolved', 'success');
    await loadAlerts();
  } catch(e) { toast(e.message, 'error'); }
}

async function clearResolvedAlerts() {
  try {
    await api.delete('/alerts/all-resolved');
    toast('Cleared resolved alerts', 'info');
    await loadAlerts();
  } catch(e) { toast(e.message, 'error'); }
}

// ══════════════════════════════════════
// SETTINGS PAGE
// ══════════════════════════════════════
async function renderSettings() {
  setActiveNav('settings');
  renderPage(`
    <div class="page-header">
      <div class="page-header-left">
        <h1>Settings</h1>
        <p>Configure the SMTP Manager Dashboard</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div class="card">
        <div class="card-header"><div class="card-title">⚙️ General Settings</div></div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Dashboard Title</label>
            <input id="s-title" class="form-input" placeholder="SMTP Manager" />
          </div>
          <div class="form-group">
            <label class="form-label">Alert Email</label>
            <input id="s-alert-email" class="form-input" type="email" placeholder="admin@yourcompany.com" />
            <div class="form-hint">Receive alerts when sites go offline (future feature)</div>
          </div>
          <div class="form-group">
            <label class="form-label">Default Plugin Folder Name</label>
            <input id="s-plugin-folder" class="form-input" placeholder="SMTP Plugin" />
            <div class="form-hint">Used in agent URL suggestions when adding sites</div>
          </div>
          <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">📋 Agent File Setup</div></div>
        <div class="card-body">
          <p style="color:var(--text2);font-size:14px;line-height:1.7;margin-bottom:16px">
            The <code style="color:var(--accent)">smtp-agent.php</code> file connects each WordPress site to this dashboard.
          </p>
          <ol style="color:var(--text2);font-size:13px;line-height:2;padding-left:18px">
            <li>Copy <code style="color:var(--accent)">smtp-agent.php</code> (in this folder) to each WP site's plugin directory</li>
            <li>Open the file and change <code style="color:var(--yellow)">YOUR_SECRET_TOKEN_HERE</code> to the site's token</li>
            <li>The agent URL format is: <br><code style="color:var(--green);font-size:11px">https://example.com/wp-content/plugins/SMTP Plugin/smtp-agent.php</code></li>
            <li>Add the site in this dashboard and click Ping to verify</li>
          </ol>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div class="card-title">📊 Database Info</div></div>
        <div class="card-body" id="db-info">
          <div class="loading-spinner"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">🔧 Quick Actions & Bulk Controls</div>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          
          <!-- Global SMTP Status Card -->
          <div class="status-summary-card" style="margin-bottom:12px;padding:14px 16px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:12px;text-transform:uppercase;color:var(--text3);font-weight:700;letter-spacing:0.5px;">Global SMTP Status</div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span id="global-smtp-status-indicator" class="badge" style="font-size:12px;padding:4px 10px;font-weight:700;border-radius:6px;">Loading...</span>
              <span id="global-smtp-counts" style="font-size:13px;color:var(--text2);font-weight:500;">Checking sites...</span>
            </div>
          </div>

          <button class="btn btn-secondary" onclick="pingAllSites();toast('Pinging all...','info',2000)">
            🏓 Ping All Sites Now
          </button>
          <button class="btn btn-secondary" onclick="clearResolvedAlerts()">
            🗑️ Clear Resolved Alerts
          </button>
          
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);margin:5px 0;">
            <span style="font-size:14px;color:var(--text);font-weight:600;">Global SMTP Routing</span>
            <div class="toggle" id="global-smtp-toggle" onclick="toggleGlobalSMTP(this)"></div>
          </div>
          
          <button class="btn btn-danger" style="opacity:0.6" onclick="confirmResetStats()">
            ⚠️ Reset All Site Statuses
          </button>
        </div>
      </div>
    </div>
  `);

  // Load settings
  try {
    const s = await api.get('/settings');
    if (document.getElementById('s-title'))         document.getElementById('s-title').value = s.title||'';
    if (document.getElementById('s-alert-email'))   document.getElementById('s-alert-email').value = s.alert_email||'';
    if (document.getElementById('s-plugin-folder')) document.getElementById('s-plugin-folder').value = s.plugin_folder||'SMTP Plugin';
  } catch(_) {}

  // DB stats
  try {
    const stats = await api.get('/dashboard/stats');
    const dbInfo = document.getElementById('db-info');
    if (dbInfo) dbInfo.innerHTML = `
      <div class="smtp-info-grid">
        <div class="smtp-info-item"><div class="label">Total Sites</div><div class="val">${stats.total}</div></div>
        <div class="smtp-info-item"><div class="label">Online</div><div class="val" style="color:var(--green)">${stats.online}</div></div>
        <div class="smtp-info-item"><div class="label">Active Alerts</div><div class="val" style="color:var(--red)">${stats.alerts}</div></div>
        <div class="smtp-info-item"><div class="label">DB File</div><div class="val" style="font-size:11px">smtp-manager.db</div></div>
      </div>
    `;
  } catch(_) {}

  // Update Global SMTP status indicator in real-time
  try {
    const stats = await api.get('/dashboard/stats');
    const badge = document.getElementById('global-smtp-status-indicator');
    const countsText = document.getElementById('global-smtp-counts');
    const globalToggle = document.getElementById('global-smtp-toggle');

    if (badge && countsText) {
      // Defensive counts to prevent undefined in case backend cache is not fully ready
      const totalSites = stats.total || 0;
      const enabledCount = stats.smtp_enabled !== undefined ? stats.smtp_enabled : totalSites;
      const disabledCount = stats.smtp_disabled !== undefined ? stats.smtp_disabled : 0;

      if (disabledCount === 0 && totalSites > 0) {
        badge.className = 'badge';
        badge.textContent = 'Active / On';
        badge.style.background = 'rgba(34, 197, 94, 0.15)';
        badge.style.color = '#22c55e';
        countsText.textContent = `Fully enabled on all ${totalSites} sites.`;
        if (globalToggle) {
          globalToggle.classList.add('on');
        }
      } else if (enabledCount === 0 && totalSites > 0) {
        badge.className = 'badge';
        badge.textContent = 'Disabled / Off';
        badge.style.background = 'rgba(239, 68, 68, 0.15)';
        badge.style.color = '#ef4444';
        countsText.textContent = `Bypassed on all ${totalSites} sites.`;
        if (globalToggle) {
          globalToggle.classList.remove('on');
        }
      } else {
        badge.className = 'badge';
        badge.textContent = 'Mixed Status';
        badge.style.background = 'rgba(234, 179, 8, 0.15)';
        badge.style.color = '#eab308';
        countsText.textContent = `${enabledCount} on, ${disabledCount} off.`;
        if (globalToggle) {
          globalToggle.classList.remove('on');
        }
      }
    }
  } catch(_) {}
}

async function saveSettings() {
  const body = {
    title:         document.getElementById('s-title')?.value||'',
    alert_email:   document.getElementById('s-alert-email')?.value||'',
    plugin_folder: document.getElementById('s-plugin-folder')?.value||'SMTP Plugin',
  };
  try {
    await api.post('/settings', body);
    toast('Settings saved!', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

function confirmResetStats() {
  if (!confirm('Reset all site statuses to "unknown"? This cannot be undone.')) return;
  toast('Status reset not implemented — ping sites to update', 'warning');
}

async function toggleGlobalSMTP(toggleEl) {
  const on = !toggleEl.classList.contains('on');
  const label = on ? 'ENABLE' : 'DISABLE';
  
  if (!confirm(`⚠️ Are you sure you want to ${label} SMTP routing across ALL registered sites?`)) return;

  // Instantly toggle class in the DOM for immediate, responsive feedback
  toggleEl.classList.toggle('on', on);
  
  const countsText = document.getElementById('global-smtp-counts');
  const badge = document.getElementById('global-smtp-status-indicator');
  if (badge) {
    badge.textContent = on ? 'Active / On' : 'Disabled / Off';
    badge.style.background = on ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    badge.style.color = on ? '#22c55e' : '#ef4444';
  }
  if (countsText) countsText.textContent = on ? 'Fully enabled on all sites.' : 'Bypassed on all sites.';

  toast(`Sending request to globally ${label} SMTP...`, 'info', 3000);
  try {
    const results = await api.post('/sites/bulk-toggle', { enabled: on });
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (failCount === 0) {
      toast(`✅ SMTP routing successfully ${on ? 'enabled' : 'disabled'} on all ${successCount} sites!`, 'success', 6000);
    } else {
      toast(`⚠️ Bulk action complete: ${successCount} succeeded, ${failCount} failed. Check alerts.`, 'warning', 6000);
    }
    // Refresh settings dynamically to align all database records
    await renderSettings();
    refreshSidebar();
  } catch(e) {
    // Revert visual state on failure
    toggleEl.classList.toggle('on', !on);
    if (badge) {
      badge.textContent = !on ? 'Active / On' : 'Disabled / Off';
      badge.style.background = !on ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
      badge.style.color = !on ? '#22c55e' : '#ef4444';
    }
    toast(`Failed to complete bulk action: ${e.message}`, 'error');
  }
}

// ── Download Agent File helper ───────────────────────────────────────────────
function downloadAgentFile(token) {
  if (!token) return toast('No token found for this site', 'error');
  const a = document.createElement('a');
  a.href = `/api/agent-file?token=${encodeURIComponent(token)}`;
  a.download = 'smtp-agent.php';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('smtp-agent.php downloaded — token is already set! Just upload to WordPress.', 'success', 6000);
}

// ══════════════════════════════════════
// PUSH UPDATES PAGE
// ══════════════════════════════════════
async function renderUpdates() {
  setActiveNav('updates');
  renderPage(`
    <div class="page-header">
      <div class="page-header-left">
        <h1>Push Updates</h1>
        <p>Push the latest plugin version to all your WordPress sites instantly</p>
      </div>
      <button class="btn btn-primary" id="push-all-btn" onclick="pushUpdateAll()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        Push to All Sites
      </button>
    </div>

    <!-- Current Version Card -->
    <div class="card" style="margin-bottom:24px">
      <div class="card-header">
        <div>
          <div class="card-title">📦 Plugin Version in Dashboard</div>
          <div class="card-subtitle">These files will be pushed to all sites</div>
        </div>
      </div>
      <div class="card-body" id="version-info">
        <div class="loading-spinner" style="margin:20px auto"></div>
      </div>
    </div>

    <!-- How it works -->
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><div class="card-title">🔄 How to Update Plugin Files</div></div>
      <div class="card-body">
        <ol style="color:var(--text2);font-size:13px;line-height:2.2;padding-left:18px">
          <li>Edit <code style="color:var(--accent)">smtp.php</code> or <code style="color:var(--accent)">smtp-agent.php</code> on your machine</li>
          <li>Copy the updated files into <code style="color:var(--accent)">SMTP-Manager/plugin/</code> folder</li>
          <li>Run <code style="color:var(--yellow)">git push origin main</code> — Vercel auto-redeploys in ~30 seconds</li>
          <li>Come back here and click <strong style="color:var(--green)">Push to All Sites</strong></li>
        </ol>
      </div>
    </div>

    <!-- Per-site push results -->
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">🌐 Sites</div>
          <div class="card-subtitle">Push update to individual sites or all at once</div>
        </div>
      </div>
      <div class="card-body" id="update-sites-list">
        <div class="loading-spinner" style="margin:20px auto"></div>
      </div>
    </div>
  `);

  // Load plugin version info
  try {
    const info = await api.get('/updates/info');
    const versionEl = document.getElementById('version-info');
    if (versionEl) {
      versionEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          ${info.map(f => `
            <div style="padding:16px;background:var(--bg2);border:1px solid var(--border);border-radius:10px">
              <div style="font-size:12px;color:var(--text3);text-transform:uppercase;font-weight:700;margin-bottom:6px">${esc(f.filename)}</div>
              ${f.found
                ? `<div style="font-size:20px;font-weight:800;color:var(--text)">v${esc(f.version)}</div>
                   <div style="font-size:12px;color:var(--text3);margin-top:4px">${(f.size/1024).toFixed(1)} KB</div>`
                : `<div style="color:var(--red);font-size:13px">⚠️ File not found in dashboard/plugin/</div>`
              }
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch(e) {
    const versionEl = document.getElementById('version-info');
    if (versionEl) versionEl.innerHTML = `<p style="color:var(--red)">${esc(e.message)}</p>`;
  }

  // Load sites list
  await loadUpdateSitesList();
}

async function loadUpdateSitesList() {
  try {
    const sites = await api.get('/sites');
    state.sites = sites;
    const el = document.getElementById('update-sites-list');
    if (!el) return;

    if (!sites.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🌐</div><h3>No Sites Yet</h3><p>Add sites first from the Sites page.</p></div>`;
      return;
    }

    el.innerHTML = `
      <table id="update-table">
        <thead>
          <tr>
            <th>Site Name</th>
            <th>URL</th>
            <th>Status</th>
            <th style="text-align:center">Update Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${sites.map(s => `
            <tr id="update-row-${s.id}">
              <td style="font-weight:700">${esc(s.name)}</td>
              <td><a href="${esc(s.url||s.agent_url)}" target="_blank" style="color:var(--accent)">${esc(s.url||'—')}</a></td>
              <td>${statusBadge(s.status)}</td>
              <td style="text-align:center" id="update-status-${s.id}"><span style="color:var(--text3);font-size:13px">—</span></td>
              <td>
                <button class="btn btn-sm btn-primary" onclick="pushUpdateOne(${s.id}, '${esc(s.name)}')">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                  Push
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e) {
    const el = document.getElementById('update-sites-list');
    if (el) el.innerHTML = `<p style="color:var(--red)">${esc(e.message)}</p>`;
  }
}

function setUpdateStatus(siteId, html) {
  const el = document.getElementById(`update-status-${siteId}`);
  if (el) el.innerHTML = html;
}

async function pushUpdateOne(id, name) {
  setUpdateStatus(id, `<div class="loading-spinner" style="margin:0 auto;width:16px;height:16px"></div>`);
  try {
    const r = await api.post(`/updates/push/${id}`);
    if (r.success) {
      setUpdateStatus(id, `<span class="badge badge-online">✅ Updated</span>`);
      toast(`✅ ${name} updated successfully!`, 'success');
    } else {
      const errMsg = (r.errors && r.errors.length) ? r.errors[0] : (r.error || 'Failed');
      setUpdateStatus(id, `<span class="badge badge-offline" title="${esc(errMsg)}">❌ Failed</span>`);
      toast(`❌ ${name}: ${errMsg}`, 'error', 6000);
    }
  } catch(e) {
    setUpdateStatus(id, `<span class="badge badge-offline" title="${esc(e.message)}">❌ Error</span>`);
    toast(`❌ ${name}: ${e.message}`, 'error', 6000);
  }
}

async function pushUpdateAll() {
  const btn = document.getElementById('push-all-btn');
  const sites = state.sites;
  if (!sites.length) return toast('No sites registered yet', 'warning');

  if (!confirm(`Push the latest plugin update to all ${sites.length} sites?`)) return;

  // Reset all statuses
  sites.forEach(s => setUpdateStatus(s.id, `<div class="loading-spinner" style="margin:0 auto;width:16px;height:16px"></div>`));
  if (btn) { btn.disabled = true; btn.textContent = 'Pushing...'; }

  toast(`Pushing update to ${sites.length} sites — this may take a minute...`, 'info', 8000);

  try {
    const results = await api.post('/updates/push-all');
    let ok = 0, fail = 0;
    results.forEach(r => {
      if (r.success) {
        ok++;
        setUpdateStatus(r.id, `<span class="badge badge-online">✅ Updated</span>`);
      } else {
        fail++;
        const errMsg = (r.errors && r.errors.length) ? r.errors[0] : (r.error || 'Failed');
        setUpdateStatus(r.id, `<span class="badge badge-offline" title="${esc(errMsg)}">❌ Failed</span>`);
      }
    });
    toast(`Push complete — ✅ ${ok} updated, ❌ ${fail} failed`, ok > 0 ? 'success' : 'error', 8000);
  } catch(e) {
    toast(`Push failed: ${e.message}`, 'error');
    sites.forEach(s => setUpdateStatus(s.id, `<span class="badge badge-offline">❌ Error</span>`));
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> Push to All Sites'; }
}

// Auto-refresh sidebar stats every 10s
setInterval(refreshSidebar, 10000);
