const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, getSetting, setSetting, getAllSettings, getRoles, setRoles, getAllHolders } = require('../db');

const app = express();
const PORT = parseInt(process.env.ADMIN_PORT || '4000');
const PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SECRET = process.env.SESSION_SECRET || 'changeme';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: SECRET, resave: false, saveUninitialized: false }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  res.redirect('/login');
}

// ── Login ─────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));

app.post('/login', (req, res) => {
  if (req.body.password === PASSWORD) {
    req.session.authed = true;
    res.redirect('/');
  } else {
    res.redirect('/login?error=1');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// ── API: Settings ─────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  res.json(getAllSettings());
});

app.post('/api/settings', requireAuth, (req, res) => {
  const allowed = [
    'moze_ca', 'rh_rpc', 'sales_webhook', 'sales_channel_id',
    'verify_channel_id', 'member_role',
  ];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      setSetting(key, req.body[key]);
    }
  }
  res.json({ ok: true });
});

// ── API: Roles ────────────────────────────────────────────────────────────────
app.get('/api/roles', requireAuth, (req, res) => {
  res.json(getRoles());
});

app.post('/api/roles', requireAuth, (req, res) => {
  const roles = req.body.roles;
  if (!Array.isArray(roles)) return res.status(400).json({ error: 'roles must be array' });
  for (const r of roles) {
    if (!r.role_name || isNaN(r.min_hold) || isNaN(r.max_hold)) {
      return res.status(400).json({ error: 'Invalid role data' });
    }
  }
  setRoles(roles);
  res.json({ ok: true });
});

// ── API: Holders ──────────────────────────────────────────────────────────────
app.get('/api/holders', requireAuth, (req, res) => {
  res.json(getAllHolders());
});

// ── API: Stats ────────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req, res) => {
  const holders = db.prepare('SELECT COUNT(*) as c FROM verified_holders').get();
  const codes = db.prepare('SELECT COUNT(*) as c FROM verify_codes WHERE used = 0').get();
  const raffles = db.prepare('SELECT COUNT(*) as c FROM raffles').get();
  res.json({
    verified_holders: holders.c,
    pending_codes: codes.c,
    total_raffles: raffles.c,
  });
});

// ── Raffle DB init ────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS raffles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    prizeLabel TEXT NOT NULL,
    imgUrl TEXT,
    opensea TEXT,
    captionHtml TEXT,
    description TEXT,
    labelTag TEXT,
    ticketCost REAL NOT NULL DEFAULT 100,
    maxTicketsPerWallet INTEGER,
    startsAt INTEGER,
    endsAt INTEGER,
    open INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`);

// ── API: Raffles (admin) ──────────────────────────────────────────────────────
app.get('/api/raffles', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM raffles ORDER BY id DESC').all();
  res.json(rows.map(r => ({ ...r, open: !!r.open })));
});

app.post('/api/raffles', requireAuth, (req, res) => {
  const { slug, title, prizeLabel, imgUrl, opensea, captionHtml,
    description, labelTag, ticketCost, maxTicketsPerWallet, startsAt, endsAt } = req.body;
  if (!slug || !title || !prizeLabel) {
    return res.status(400).json({ error: 'slug, title, prizeLabel required' });
  }
  try {
    const result = db.prepare(`
      INSERT INTO raffles (slug, title, prizeLabel, imgUrl, opensea, captionHtml,
        description, labelTag, ticketCost, maxTicketsPerWallet, startsAt, endsAt, open)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(slug, title, prizeLabel,
      imgUrl || null, opensea || null, captionHtml || null,
      description || null, labelTag || null,
      Number(ticketCost) || 100, maxTicketsPerWallet ? Number(maxTicketsPerWallet) : null,
      startsAt || null, endsAt || null);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/raffles/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT * FROM raffles WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const u = { ...existing, ...req.body };
  try {
    db.prepare(`
      UPDATE raffles SET slug=?, title=?, prizeLabel=?, imgUrl=?, opensea=?,
        captionHtml=?, description=?, labelTag=?, ticketCost=?,
        maxTicketsPerWallet=?, startsAt=?, endsAt=?, open=?
      WHERE id=?
    `).run(u.slug, u.title, u.prizeLabel, u.imgUrl || null, u.opensea || null,
      u.captionHtml || null, u.description || null, u.labelTag || null,
      Number(u.ticketCost) || 100, u.maxTicketsPerWallet ? Number(u.maxTicketsPerWallet) : null,
      u.startsAt || null, u.endsAt || null, u.open ? 1 : 0, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/raffles/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM raffles WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── Public raffle API (for moze site frontend, no auth) ───────────────────────
app.get('/public/raffles', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const rows = db.prepare('SELECT * FROM raffles ORDER BY id ASC').all();
  res.json(rows.map(r => ({ ...r, open: !!r.open })));
});

app.listen(PORT, () => {
  console.log(`[dashboard] Admin dashboard running at http://localhost:${PORT}`);
});
