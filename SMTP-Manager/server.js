const express      = require('express');
const axios        = require('axios');
const cookieParser = require('cookie-parser');
const { createClient } = process.env.TURSO_DATABASE_URL
  ? require('@libsql/client/web')
  : require('@libsql/client');
const path      = require('path');
const fs        = require('fs');
const https     = require('https');
const crypto    = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// Plugin files distributed to WordPress sites via Push Updates.
// Relative paths inside the plugin folder, always forward slashes —
// must match the $allowed whitelist in smtp-agent.php agent_push_update().
const PLUGIN_PUSH_FILES = [
  'smtp.php',
  'smtp-agent.php',
  'index.php',
  'includes/cf7-integration.php',
  'includes/index.php',
  'assets/admin.css',
  'assets/admin.js',
  'assets/cf7-timing.js',
  'assets/index.php',
];

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
    rest_url     TEXT    DEFAULT '',
    created_at   INTEGER DEFAULT (strftime('%s','now'))
  )`);
  // Add rest_url column to existing DBs that predate this field
  try { await db.execute(`ALTER TABLE sites ADD COLUMN rest_url TEXT DEFAULT ''`); } catch {};
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
  await db.execute(`CREATE TABLE IF NOT EXISTS plugin_files (
    filename    TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    version     TEXT DEFAULT 'unknown',
    uploaded_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  try { await db.execute("ALTER TABLE sites ADD COLUMN smtp_enabled INTEGER DEFAULT 1"); } catch(_) {}

  // Seed plugin files from disk into DB.
  // Refreshes the DB copy whenever the bundled file differs from what's stored,
  // so every deploy automatically updates the files that get pushed to sites.
  const PLUGIN_DIR = path.join(__dirname, 'plugin');
  for (const filename of PLUGIN_PUSH_FILES) {
    const filePath = path.join(PLUGIN_DIR, filename);
    if (fs.existsSync(filePath)) {
      const content  = fs.readFileSync(filePath, 'utf8');
      const verMatch = content.match(/Version:\s*([^\n\r*]+)/);
      const version  = verMatch ? verMatch[1].trim() : 'unknown';
      const existing = await db.execute({ sql: 'SELECT content FROM plugin_files WHERE filename = ?', args: [filename] });
      const dbContent = existing.rows.length ? existing.rows[0].content : null;
      if (dbContent !== content) {
        await db.execute({
          sql: `INSERT OR REPLACE INTO plugin_files (filename, content, version, uploaded_at) VALUES (?, ?, ?, strftime('%s','now'))`,
          args: [filename, content, version]
        });
        console.log(`[PLUGIN] ${dbContent === null ? 'Seeded' : 'Refreshed'} ${filename} v${version} in DB`);
      }
    }
  }
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
app.use(cookieParser());

// ─── Auth — Stateless JWT (works on Vercel serverless, no in-memory state) ─────
const ADMIN_USER     = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS     = process.env.ADMIN_PASSWORD || 'smtp@admin2024';
const JWT_SECRET     = process.env.SESSION_SECRET || 'smtp_fallback_session_secret_2024';
const JWT_EXPIRES_IN = 7 * 24 * 60 * 60; // 7 days in seconds

// Minimal JWT — sign/verify using HMAC-SHA256, no external package needed
function base64url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
function createJWT(payload) {
  const header  = base64url(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const body    = base64url(JSON.stringify(payload));
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64')
                    .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${header}.${body}.${sig}`;
}
function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64')
                      .replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}
function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}
function getSession(req) {
  // Check Authorization header first (API calls from app.js)
  // Then fall back to cookie (browser page navigations)
  const token = getBearerToken(req) || req.cookies?.smtp_auth;
  if (!token) return null;
  return verifyJWT(token);
}

// Public routes — no auth required
// NOTE: do NOT add '/' here — startsWith('/') matches everything and breaks auth
const PUBLIC_PATHS = [
  '/api/login', '/api/heartbeat', '/api/register',
  '/login', '/login.html',
  '/index.html',            // landing page
  '/style.css',             // dashboard styles (loaded by dashboard.html)
];

// Auth guard middleware
function authMiddleware(req, res, next) {
  // Landing page (root) is always public
  if (req.path === '/') return next();
  // Explicitly listed public paths
  if (PUBLIC_PATHS.some(p => req.path === p)) return next();
  // Static assets (.css, .js, images, fonts) are public
  if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/.test(req.path)) return next();
  // All /api/* routes except public ones require a valid JWT
  if (req.path.startsWith('/api/')) {
    const sess = getSession(req);
    if (!sess) return res.status(401).json({ error: 'Unauthorized — please login' });
  }
  next();
}

// Cookie options — httpOnly prevents JS from reading it (XSS safe)
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV !== 'development', // HTTPS only in production
  sameSite: 'lax',
  maxAge:   JWT_EXPIRES_IN * 1000, // milliseconds
  path:     '/',
};

// ─── Auth endpoints ────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = createJWT({
      sub: username,
      iat: Math.floor(Date.now()/1000),
      exp: Math.floor(Date.now()/1000) + JWT_EXPIRES_IN
    });
    // Set cookie for browser page navigation auth
    res.cookie('smtp_auth', token, COOKIE_OPTS);
    return res.json({ success: true, token, username });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie('smtp_auth', { path: '/' });
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  const sess = getSession(req);
  if (!sess) return res.status(401).json({ error: 'Not logged in' });
  res.json({ username: sess.sub, expires: sess.exp * 1000 });
});

// Apply auth guard
app.use(authMiddleware);

// Serve static files AFTER auth check
app.use(express.static(path.join(__dirname, 'public')));

// Redirect /login to login page
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Auth guard for HTML pages — reads the httpOnly cookie set at login
function authRequired(req, res, next) {
  const sess = getSession(req); // reads cookie automatically via cookieParser
  if (!sess) return res.redirect('/login');
  next();
}

// Dashboard — protected by cookie-based auth
app.get('/dashboard', authRequired, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

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

// Safely encode a URL that may have spaces in path segments (e.g. "SMTP Plugin Final")
function encodeAgentUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.pathname = u.pathname.split('/').map(seg => encodeURIComponent(decodeURIComponent(seg))).join('/');
    return u.toString();
  } catch {
    return encodeURI(rawUrl);
  }
}

// Build the REST API agent URL from a site's base URL
// e.g. https://example.com → https://example.com/wp-json/smtp-fallback/v1/agent
function restAgentUrl(site) {
  const base = (site.rest_url || (site.url.replace(/\/+$/, '') + '/wp-json/smtp-fallback/v1/agent'));
  return base;
}

// Make one HTTP attempt to a given url+method+headers+body
async function httpAttempt(url, method, headers, body) {
  const cfg = { method, url, headers };
  if (body) cfg.data = body;
  const res = await agentHttp(cfg);
  return res.data;
}

function friendlyError(err) {
  if (err.response) {
    const code = err.response.status;
    if (code === 403) return new Error(`Blocked by firewall (403) — Cloudflare/WAF is blocking the request.`);
    if (code === 404) return new Error(`Not found (404) — agent endpoint missing. Use Push Update or check the Agent URL.`);
    if (code === 401) return new Error(`Unauthorized (401) — API token mismatch.`);
    if (code === 500) return new Error(`Server error (500) — WordPress site has an internal error.`);
    return new Error(`HTTP ${code} from site.`);
  }
  if (err.code === 'ECONNREFUSED') return new Error(`Connection refused — site server is down.`);
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') return new Error(`Connection timed out — site is slow or unreachable.`);
  if (err.code === 'ENOTFOUND') return new Error(`Domain not found — DNS lookup failed. Site domain may have expired.`);
  return err;
}

async function callAgent(site, action, method = 'GET', body = null) {
  const siteOrigin = (() => { try { return new URL(site.url).origin; } catch { return site.url; } })();

  const headers = {
    'X-Agent-Token':   site.api_token,
    'Content-Type':    'application/json',
    'Accept':          'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control':   'no-cache',
    'Origin':          siteOrigin,
    'Referer':         siteOrigin + '/',
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  };

  // ── Attempt 1: WordPress REST API (/wp-json/smtp-fallback/v1/agent)
  // Cloudflare & Wordfence always whitelist /wp-json/ traffic
  const restUrl = `${restAgentUrl(site)}?action=${action}`;
  try {
    return await httpAttempt(restUrl, method, headers, body);
  } catch (restErr) {
    const restCode = restErr.response?.status;
    // Only fall through if REST is not available (404/not installed) or blocked (403/500)
    // If it's a token error (401) that's definitive — don't try the other URL
    if (restCode === 401) throw friendlyError(restErr);

    // ── Attempt 2: Direct agent file (smtp-agent.php) — URL-encoded path
    const encodedBase = encodeAgentUrl(site.agent_url);
    const directUrl = `${encodedBase}?action=${action}`;
    try {
      return await httpAttempt(directUrl, method, headers, body);
    } catch (directErr) {
      // Both failed — throw the most descriptive error
      throw friendlyError(directErr);
    }
  }
}

// Insert alert only if no unresolved alert of same type already exists for this site
async function createAlertIfNew(site_id, type, message) {
  const existing = await dbGet(
    'SELECT id FROM alerts WHERE site_id=? AND type=? AND resolved=0 LIMIT 1',
    [site_id, type]
  );
  if (!existing) {
    await dbRun('INSERT INTO alerts (site_id, type, message) VALUES (?, ?, ?)', [site_id, type, message]);
  }
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
    // Auto-resolve any existing offline alert when site comes back online
    await dbRun("UPDATE alerts SET resolved=1 WHERE site_id=? AND type='offline' AND resolved=0", [site.id]);
    res.json({ status: 'online', data });
  } catch (err) {
    await dbRun("UPDATE sites SET status='offline', last_ping=? WHERE id=?", [now(), site.id]);
    await createAlertIfNew(site.id, 'offline', `${site.name} is offline: ${err.message}`);
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
      await dbRun("UPDATE alerts SET resolved=1 WHERE site_id=? AND type='offline' AND resolved=0", [site.id]);
      results.push({ id: site.id, name: site.name, status: 'online', data });
    } catch (err) {
      await dbRun("UPDATE sites SET status='offline', last_ping=? WHERE id=?", [now(), site.id]);
      await createAlertIfNew(site.id, 'offline', `${site.name} is offline: ${err.message}`);
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

// ─── Plugin Update Push (files stored in Turso DB — works reliably in serverless) ─
app.get('/api/updates/info', async (req, res) => {
  const rows = await dbAll('SELECT filename, version, uploaded_at, length(content) AS size FROM plugin_files');
  res.json(rows.map(r => ({ ...r, found: true })));
});

// Upload / replace a plugin file in DB
app.post('/api/updates/upload', async (req, res) => {
  const { filename, content } = req.body;
  if (!PLUGIN_PUSH_FILES.includes(filename)) return res.status(400).json({ error: 'Filename not allowed' });
  if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Content is required' });
  const isPhp = filename.endsWith('.php');
  if (isPhp && !content.includes('<?php')) return res.status(400).json({ error: 'Invalid PHP content' });
  if (!isPhp && content.includes('<?php')) return res.status(400).json({ error: 'PHP code not allowed in asset files' });
  const verMatch = content.match(/Version:\s*([^\n\r*]+)/);
  const version  = verMatch ? verMatch[1].trim() : 'unknown';
  await dbRun('INSERT OR REPLACE INTO plugin_files (filename, content, version, uploaded_at) VALUES (?, ?, ?, ?)',
    [filename, content, version, now()]);
  res.json({ success: true, filename, version, size: content.length });
});

// Helper: load all plugin files from DB as { filename: content }
async function loadPluginFiles() {
  const rows = await dbAll('SELECT filename, content FROM plugin_files');
  if (!rows.length) throw { status: 400, message: 'No plugin files in DB. Upload them first from the Push Updates page.' };
  const files = {};
  rows.forEach(r => { files[r.filename] = r.content; });
  return files;
}

// Push plugin files to one site in two phases: the agent file first, then
// everything else. Agents older than 1.1.0 reject subdirectory paths but
// accept smtp.php — a single-call push against an old agent could write the
// new smtp.php while its includes/ dependency gets rejected, breaking the
// site. Upgrading the agent first makes the full push safe.
async function pushFilesToSite(site, files) {
  if (files['smtp-agent.php']) {
    const phase1 = await callAgent(site, 'push_update', 'POST', {
      files: { 'smtp-agent.php': files['smtp-agent.php'] }
    });
    if (!phase1 || phase1.success !== true) {
      return phase1 || { success: false, error: 'Agent update failed' };
    }
    // Give PHP opcache time to pick up the replaced agent before the full push
    await new Promise(r => setTimeout(r, 2000));
  }
  const rest = { ...files };
  delete rest['smtp-agent.php'];
  if (!Object.keys(rest).length) {
    return { success: true, updated: ['smtp-agent.php'], message: 'smtp-agent.php updated successfully' };
  }
  const phase2 = await callAgent(site, 'push_update', 'POST', { files: rest });
  if (phase2 && Array.isArray(phase2.updated) && files['smtp-agent.php']) {
    phase2.updated.unshift('smtp-agent.php');
  }
  return phase2;
}

// Push to a single site
app.post('/api/updates/push/:id', wrap(async (req, res) => {
  const site  = await getSite(req.params.id);
  const files = await loadPluginFiles();
  const data  = await pushFilesToSite(site, files);
  res.json({ id: site.id, name: site.name, url: site.url, ...data });
}));

// Push to ALL sites
app.post('/api/updates/push-all', async (req, res) => {
  const sites = await dbAll('SELECT * FROM sites');
  let files;
  try { files = await loadPluginFiles(); }
  catch(e) { return res.status(400).json({ error: e.message }); }

  const results = [];
  for (const site of sites) {
    try {
      const data = await pushFilesToSite(site, files);
      results.push({ id: site.id, name: site.name, url: site.url, ...data });
    } catch (err) {
      results.push({ id: site.id, name: site.name, url: site.url, success: false, error: err.message });
    }
  }
  res.json(results);
});

// ─── Heartbeat endpoint ────────────────────────────────────────────────────────
// WordPress pushes status here every 5 min via WP Cron (outbound — never blocked by firewalls)
app.post('/api/heartbeat', async (req, res) => {
  const { api_token, site_url, site_name, rest_url, smtp_enabled } = req.body || {};
  if (!api_token) return res.status(400).json({ error: 'api_token required' });

  const site = await dbGet('SELECT * FROM sites WHERE api_token = ?', [api_token]);
  if (!site) return res.status(404).json({ error: 'Site not found — register first' });

  // Update status to online and save the REST URL for future polling
  await dbRun(
    "UPDATE sites SET status='online', last_ping=?, rest_url=?, smtp_enabled=? WHERE id=?",
    [now(), rest_url || site.rest_url || '', smtp_enabled ? 1 : 0, site.id]
  );
  // Auto-resolve any active offline alert
  await dbRun(
    "UPDATE alerts SET resolved=1 WHERE site_id=? AND type='offline' AND resolved=0",
    [site.id]
  );

  res.json({ success: true, message: 'Heartbeat received', site_id: site.id });
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
