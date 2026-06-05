const express   = require('express');
const axios     = require('axios');
const { createClient } = require('@libsql/client/web');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');
const crypto    = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Database ─────────────────────────────────────────────────────────────────
const db = createClient({
  url:       process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  await db.execute(`CREATE TABLE IF NOT EXISTS sites (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    url          TEXT    NOT NULL DEFAULT '',
    agent_url    TEXT    NOT NULL,
    api_token    TEXT    NOT NULL,
    status       TEXT    DEFAULT 'unknown',
    last_ping    INTEGER DEFAULT 0,
    notes        TEXT    DEFAULT '',
    smtp_enabled INTEGER DEFAULT 1,
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id    INTEGER,
    type       TEXT,
    message    TEXT,
    resolved   INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS site_cache (
    site_id    INTEGER PRIMARY KEY,
    data       TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  try { await db.execute("ALTER TABLE sites ADD COLUMN smtp_enabled INTEGER DEFAULT 1"); } catch(_) {}
}

// Lazy init — runs once per cold start, resets on failure so next request retries
let _dbReady = null;
function ensureDB() {
  if (!_dbReady) {
    _dbReady = initDB().catch(err => {
      _dbReady = null; // allow retry on next request
      throw err;
    });
  }
  return _dbReady;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────
async function dbAll(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows.map(row => {
    const obj = {};
    for (const col of result.columns) obj[col] = row[col];
    return obj;
  });
}
async function dbGet(sql, args = []) {
  const rows = await dbAll(sql, args);
  return rows[0] || null;
}
async function dbRun(sql, args = []) {
  await db.execute({ sql, args });
}
async function dbInsert(sql, args = []) {
  const result = await db.execute({ sql, args });
  return Number(result.lastInsertRowid);
}
function now() { return Math.floor(Date.now() / 1000); }

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(async (_req, _res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    console.error('[DB INIT ERROR]', err.message, err.stack);
    _res.status(500).json({ error: 'Database connection failed: ' + err.message });
  }
});

// ─── HTTP Client for WP Sites ──────────────────────────────────────────────────
const agentHttp = axios.create({
  timeout: 8000,
  httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

async function callAgent(site, action, method = 'GET', body = null) {
  const url = `${site.agent_url}?action=${action}`;
  const cfg = {
    method, url,
    headers: {
      'X-Agent-Token':  site.api_token,
      'Content-Type':   'application/json',
      'Accept':         'application/json'
    }
  };
  if (body) cfg.data = body;
  const res = await agentHttp(cfg);
  return res.data;
}

async function getSite(id) {
  const site = await dbGet('SELECT * FROM sites WHERE id = ?', [id]);
  if (!site) throw { status: 404, message: 'Site not found' };
  return site;
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) { res.status(err.status || 500).json({ error: err.message || 'Error' }); }
  };
}

// ─── SITES API ────────────────────────────────────────────────────────────────

app.get('/api/sites', async (req, res) => {
  res.json(await dbAll('SELECT * FROM sites ORDER BY created_at DESC'));
});

app.post('/api/sites', async (req, res) => {
  const { name, url, agent_url, api_token, notes } = req.body;
  if (!name || !agent_url || !api_token)
    return res.status(400).json({ error: 'Name, Agent URL, and API token are required' });
  const id = await dbInsert(
    'INSERT INTO sites (name, url, agent_url, api_token, notes) VALUES (?, ?, ?, ?, ?)',
    [name, (url || '').replace(/\/+$/, ''), agent_url.trim(), api_token.trim(), notes || '']
  );
  const site = await dbGet('SELECT * FROM sites WHERE id = ?', [id]);
  res.json(site);
});

app.put('/api/sites/:id', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  const { name, url, agent_url, api_token, notes } = req.body;
  await dbRun('UPDATE sites SET name=?, url=?, agent_url=?, api_token=?, notes=? WHERE id=?', [
    name || site.name,
    (url || site.url || '').replace(/\/+$/, ''),
    agent_url || site.agent_url,
    api_token || site.api_token,
    notes !== undefined ? notes : site.notes,
    site.id
  ]);
  res.json(await dbGet('SELECT * FROM sites WHERE id = ?', [site.id]));
}));

app.delete('/api/sites/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await dbRun('DELETE FROM sites WHERE id = ?', [id]);
  await dbRun('DELETE FROM alerts WHERE site_id = ?', [id]);
  await dbRun('DELETE FROM site_cache WHERE site_id = ?', [id]);
  res.json({ success: true });
});

// Ping one site
app.post('/api/sites/:id/ping', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  try {
    const data = await callAgent(site, 'ping');
    await dbRun("UPDATE sites SET status='online', last_ping=? WHERE id=?", [now(), site.id]);
    res.json({ status: 'online', data });
  } catch (err) {
    await dbRun("UPDATE sites SET status='offline', last_ping=? WHERE id=?", [now(), site.id]);
    await dbRun('INSERT INTO alerts (site_id, type, message) VALUES (?, ?, ?)',
      [site.id, 'offline', `${site.name} is offline: ${err.message}`]);
    res.json({ status: 'offline', error: err.message });
  }
}));

// Ping all sites
app.post('/api/sites/ping-all', async (req, res) => {
  const sites = await dbAll('SELECT * FROM sites');
  const results = [];
  for (const site of sites) {
    try {
      const data = await callAgent(site, 'ping');
      await dbRun("UPDATE sites SET status='online', last_ping=? WHERE id=?", [now(), site.id]);
      results.push({ id: site.id, name: site.name, status: 'online', data });
    } catch (err) {
      await dbRun("UPDATE sites SET status='offline', last_ping=? WHERE id=?", [now(), site.id]);
      results.push({ id: site.id, name: site.name, status: 'offline', error: err.message });
    }
  }
  res.json(results);
});

// Bulk push settings
app.post('/api/sites/bulk-settings', wrap(async (req, res) => {
  const { site_ids, settings } = req.body;
  const results = [];
  for (const id of site_ids) {
    const site = await dbGet('SELECT * FROM sites WHERE id = ?', [id]);
    if (!site) { results.push({ id, error: 'Not found' }); continue; }
    try {
      const data = await callAgent(site, 'save_settings', 'POST', { settings });
      results.push({ id, name: site.name, success: true, data });
    } catch (err) {
      results.push({ id, success: false, error: err.message });
    }
  }
  res.json(results);
}));

// Bulk toggle SMTP
app.post('/api/sites/bulk-toggle', wrap(async (req, res) => {
  const { enabled } = req.body;
  const sites = await dbAll('SELECT * FROM sites');
  const smtpVal = enabled ? 1 : 0;
  await dbRun("UPDATE sites SET smtp_enabled=?", [smtpVal]);
  const results = [];
  for (const site of sites) {
    try {
      const data = await callAgent(site, 'toggle_plugin', 'POST', { enabled: !!enabled });
      results.push({ id: site.id, name: site.name, success: true, data });
    } catch (err) {
      results.push({ id: site.id, name: site.name, success: false, error: err.message });
    }
  }
  res.json(results);
}));

// Full status
app.get('/api/sites/:id/status', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  try {
    const data = await callAgent(site, 'status');
    await dbRun('INSERT OR REPLACE INTO site_cache (site_id, data, updated_at) VALUES (?, ?, ?)',
      [site.id, JSON.stringify(data), now()]);
    const smtpVal = data.smtp_enabled ? 1 : 0;
    await dbRun("UPDATE sites SET status='online', smtp_enabled=? WHERE id=?", [smtpVal, site.id]);
    res.json(data);
  } catch (err) {
    await dbRun("UPDATE sites SET status='offline' WHERE id=?", [site.id]);
    const cached = await dbGet('SELECT * FROM site_cache WHERE site_id = ?', [site.id]);
    if (cached) return res.json({ ...JSON.parse(cached.data), _cached: true, _offline: true });
    res.status(503).json({ error: err.message });
  }
}));

// SMTP settings
app.get('/api/sites/:id/settings', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  res.json(await callAgent(site, 'get_settings'));
}));

app.post('/api/sites/:id/settings', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  res.json(await callAgent(site, 'save_settings', 'POST', req.body));
}));

// Logs
app.get('/api/sites/:id/logs', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  res.json(await callAgent(site, 'get_logs'));
}));

// Submissions
app.get('/api/sites/:id/submissions', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  res.json(await callAgent(site, 'get_submissions'));
}));

// Test email
app.post('/api/sites/:id/test-email', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  res.json(await callAgent(site, 'test_email', 'POST', req.body));
}));

// Toggle plugin
app.post('/api/sites/:id/toggle', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  const data = await callAgent(site, 'toggle_plugin', 'POST', req.body);
  const smtpVal = req.body.enabled ? 1 : 0;
  await dbRun("UPDATE sites SET smtp_enabled=? WHERE id=?", [smtpVal, site.id]);
  res.json(data);
}));

// ─── Dashboard stats ──────────────────────────────────────────────────────────
async function getStats() {
  const [total, online, offline, unknown, alerts, smtp_enabled, smtp_disabled] = await Promise.all([
    dbGet('SELECT COUNT(*) c FROM sites'),
    dbGet("SELECT COUNT(*) c FROM sites WHERE status='online'"),
    dbGet("SELECT COUNT(*) c FROM sites WHERE status='offline'"),
    dbGet("SELECT COUNT(*) c FROM sites WHERE status='unknown'"),
    dbGet('SELECT COUNT(*) c FROM alerts WHERE resolved=0'),
    dbGet("SELECT COUNT(*) c FROM sites WHERE smtp_enabled=1"),
    dbGet("SELECT COUNT(*) c FROM sites WHERE smtp_enabled=0"),
  ]);
  return {
    total:         Number(total.c),
    online:        Number(online.c),
    offline:       Number(offline.c),
    unknown:       Number(unknown.c),
    alerts:        Number(alerts.c),
    smtp_enabled:  Number(smtp_enabled.c),
    smtp_disabled: Number(smtp_disabled.c),
  };
}

app.get('/api/dashboard/stats', async (req, res) => {
  res.json(await getStats());
});

// ─── Alerts ───────────────────────────────────────────────────────────────────
app.get('/api/alerts', async (req, res) => {
  res.json(await dbAll(`
    SELECT a.*, s.name site_name, s.url site_url
    FROM alerts a LEFT JOIN sites s ON a.site_id = s.id
    ORDER BY a.created_at DESC LIMIT 200
  `));
});

app.put('/api/alerts/:id/resolve', async (req, res) => {
  await dbRun('UPDATE alerts SET resolved=1 WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

app.delete('/api/alerts/all-resolved', async (req, res) => {
  await dbRun('DELETE FROM alerts WHERE resolved=1');
  res.json({ success: true });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  const rows = await dbAll('SELECT * FROM settings');
  const obj  = {};
  rows.forEach(r => (obj[r.key] = r.value));
  res.json(obj);
});

app.post('/api/settings', async (req, res) => {
  for (const [k, v] of Object.entries(req.body))
    await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, String(v)]);
  res.json({ success: true });
});

// ─── Plugin Update Push ───────────────────────────────────────────────────────
const PLUGIN_DIR = path.join(__dirname, 'plugin');

app.get('/api/updates/info', (req, res) => {
  const filenames = ['smtp.php', 'smtp-agent.php'];
  const info = filenames.map(filename => {
    const filePath = path.join(PLUGIN_DIR, filename);
    if (!fs.existsSync(filePath)) return { filename, found: false };
    const content  = fs.readFileSync(filePath, 'utf8');
    const verMatch = content.match(/Version:\s*([^\n\r*]+)/);
    const version  = verMatch ? verMatch[1].trim() : 'unknown';
    return { filename, version, size: content.length, found: true };
  });
  res.json(info);
});

app.post('/api/updates/push/:id', wrap(async (req, res) => {
  const site = await getSite(req.params.id);
  const files = {};
  for (const filename of ['smtp.php', 'smtp-agent.php']) {
    const filePath = path.join(PLUGIN_DIR, filename);
    if (fs.existsSync(filePath)) files[filename] = fs.readFileSync(filePath, 'utf8');
  }
  if (!Object.keys(files).length)
    return res.status(400).json({ error: 'No plugin files found in dashboard/plugin/' });
  const data = await callAgent(site, 'push_update', 'POST', { files });
  res.json({ id: site.id, name: site.name, url: site.url, ...data });
}));

app.post('/api/updates/push-all', async (req, res) => {
  const sites = await dbAll('SELECT * FROM sites');
  const files = {};
  for (const filename of ['smtp.php', 'smtp-agent.php']) {
    const filePath = path.join(PLUGIN_DIR, filename);
    if (fs.existsSync(filePath)) files[filename] = fs.readFileSync(filePath, 'utf8');
  }
  if (!Object.keys(files).length)
    return res.status(400).json({ error: 'No plugin files found in dashboard/plugin/' });
  const results = [];
  for (const site of sites) {
    try {
      const data = await callAgent(site, 'push_update', 'POST', { files });
      results.push({ id: site.id, name: site.name, url: site.url, ...data });
    } catch (err) {
      results.push({ id: site.id, name: site.name, url: site.url, success: false, error: err.message });
    }
  }
  res.json(results);
});

// ─── Auto-Registration endpoint (called by WordPress plugin on activation) ────
app.post('/api/register', async (req, res) => {
  // Verify the shared registration key
  const key = req.headers['x-registration-key'] || '';
  const validKey = process.env.SMTP_REGISTRATION_KEY || 'smtpfallback_reg_shubham_2024_secure';
  if (!key || key !== validKey) {
    return res.status(401).json({ error: 'Invalid registration key' });
  }

  const { name, url, agent_url, api_token, notes } = req.body;
  if (!name || !agent_url || !api_token)
    return res.status(400).json({ error: 'name, agent_url, and api_token are required' });

  // If this site is already registered (same agent_url), update it instead of duplicating
  const existing = await dbGet('SELECT * FROM sites WHERE agent_url = ?', [agent_url.trim()]);
  if (existing) {
    await dbRun(
      'UPDATE sites SET name=?, url=?, api_token=?, notes=?, status=? WHERE id=?',
      [name, (url || '').replace(/\/+$/, ''), api_token.trim(), notes || existing.notes, 'unknown', existing.id]
    );
    const updated = await dbGet('SELECT * FROM sites WHERE id = ?', [existing.id]);
    return res.json({ success: true, action: 'updated', site: updated });
  }

  // New site — insert
  const id = await dbInsert(
    'INSERT INTO sites (name, url, agent_url, api_token, notes) VALUES (?, ?, ?, ?, ?)',
    [name, (url || '').replace(/\/+$/, ''), agent_url.trim(), api_token.trim(), notes || '']
  );
  const site = await dbGet('SELECT * FROM sites WHERE id = ?', [id]);
  res.json({ success: true, action: 'created', site });
});

// Generate token (uses built-in crypto — no uuid package needed)
app.get('/api/generate-token', (req, res) => {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  res.json({ token });
});

// Download ready-to-use smtp-agent.php with token pre-filled
app.get('/api/agent-file', (req, res) => {
  const token     = (req.query.token || '').trim();
  const agentPath = path.join(__dirname, 'smtp-agent.php');

  if (!token) return res.status(400).json({ error: 'token query parameter is required' });
  if (!fs.existsSync(agentPath))
    return res.status(404).json({ error: 'smtp-agent.php not found' });

  let content = fs.readFileSync(agentPath, 'utf8');
  content = content.replace(
    "define('SMTP_AGENT_TOKEN', 'YOUR_SECRET_TOKEN_HERE');",
    `define('SMTP_AGENT_TOKEN', '${token}');`
  );

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="smtp-agent.php"');
  res.send(content);
});

// ─── Start (local dev) / Export (Vercel) ─────────────────────────────────────
if (require.main === module) {
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log('\n╔═══════════════════════════════════════╗');
      console.log('║   SMTP Manager Dashboard - RUNNING    ║');
      console.log('╠═══════════════════════════════════════╣');
      console.log(`║  Open: http://localhost:${PORT}          ║`);
      console.log('║  Press Ctrl+C to stop                 ║');
      console.log('╚═══════════════════════════════════════╝\n');
    });
  }).catch(err => { console.error('Failed to start:', err); process.exit(1); });
} else {
  module.exports = app;
}
