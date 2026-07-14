const express = require('express');
const session = require('express-session');
const path = require('path');
const { db, getSetting, setSetting, getAllSettings, getRoles, setRoles, getAllHolders } = require('../db');

// Node 18+ has global fetch; keep explicit for older runtimes if needed
const fetch = globalThis.fetch;

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
app.get('/api/stats', requireAuth, async (req, res) => {
  const holders = db.prepare('SELECT COUNT(*) as c FROM verified_holders').get();
  const codes = db.prepare('SELECT COUNT(*) as c FROM verify_codes WHERE used = 0').get();
  let totalRaffles = 0;
  try {
    const data = await mozeAdmin('/v1/admin/raffles');
    totalRaffles = (data.raffles || []).length;
  } catch {
    /* moze-api optional for stats */
  }
  res.json({
    verified_holders: holders.c,
    pending_codes: codes.c,
    total_raffles: totalRaffles,
  });
});

// ── Raffles → proxy to moze-api (live site source of truth) ───────────────────
// Local SQLite raffles table is no longer used for site raffles.
const MOZE_API = (process.env.MOZE_API_URL || 'https://api.mozestreet.art').replace(/\/$/, '');
const MOZE_ADMIN_SECRET = process.env.MOZE_ADMIN_SECRET || process.env.ADMIN_SECRET || '';

function mapApiRaffle(r) {
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    prizeLabel: r.prizeLabel || r.prize_label,
    description: r.description || '',
    ticketCost: r.ticketCost ?? r.ticket_cost,
    maxTicketsPerWallet: r.maxTicketsPerWallet ?? r.max_tickets_per_wallet,
    startsAt: r.startsAt ?? r.starts_at,
    endsAt: r.endsAt ?? r.ends_at,
    status: r.status,
    open: !!(r.open ?? (r.status === 'open')),
    totalTickets: r.totalTickets || 0,
    entrants: r.entrants || 0,
    // optional UI fields (not stored in moze-api yet)
    imgUrl: r.imgUrl || null,
    opensea: r.opensea || null,
    captionHtml: r.captionHtml || null,
    labelTag: r.labelTag || null,
  };
}

async function mozeAdmin(path, { method = 'GET', body } = {}) {
  if (!MOZE_ADMIN_SECRET) {
    const err = new Error('MOZE_ADMIN_SECRET / ADMIN_SECRET not set — cannot manage live raffles');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${MOZE_API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-secret': MOZE_ADMIN_SECRET,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `moze-api ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── API: Raffles (admin) — wired to moze-api ──────────────────────────────────
app.get('/api/raffles', requireAuth, async (req, res) => {
  try {
    const data = await mozeAdmin('/v1/admin/raffles');
    res.json((data.raffles || []).map(mapApiRaffle));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/raffles', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.slug || !b.title || !b.prizeLabel) {
    return res.status(400).json({ error: 'slug, title, prizeLabel required' });
  }
  try {
    const data = await mozeAdmin('/v1/admin/raffles', {
      method: 'POST',
      body: {
        slug: b.slug,
        title: b.title,
        prizeLabel: b.prizeLabel,
        description: b.description || '',
        ticketCost: Number(b.ticketCost) || 1,
        maxTicketsPerWallet: b.maxTicketsPerWallet ? Number(b.maxTicketsPerWallet) : null,
        startsAt: b.startsAt || null,
        endsAt: b.endsAt || null,
        status: b.open ? 'open' : (b.status || 'open'),
      },
    });
    res.json({ ok: true, id: data.raffle?.id, raffle: mapApiRaffle(data.raffle) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.put('/api/raffles/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b = req.body || {};
  try {
    const data = await mozeAdmin(`/v1/admin/raffles/${id}`, {
      method: 'PUT',
      body: {
        slug: b.slug,
        title: b.title,
        prizeLabel: b.prizeLabel,
        description: b.description,
        ticketCost: b.ticketCost != null ? Number(b.ticketCost) : undefined,
        maxTicketsPerWallet:
          b.maxTicketsPerWallet === '' || b.maxTicketsPerWallet == null
            ? null
            : Number(b.maxTicketsPerWallet),
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        open: b.open,
        status: b.status,
      },
    });
    res.json({ ok: true, raffle: mapApiRaffle(data.raffle) });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.delete('/api/raffles/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const force = req.query.force === '1' ? '?force=1' : '';
  try {
    await mozeAdmin(`/v1/admin/raffles/${id}${force}`, { method: 'DELETE' });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ── Public raffle API — proxy moze-api public list (no auth) ──────────────────
app.get('/public/raffles', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch(`${MOZE_API}/v1/raffle`, { timeout: 10000 });
    const data = await r.json();
    res.json((data.raffles || []).map(mapApiRaffle));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[dashboard] Admin dashboard running at http://localhost:${PORT}`);
});
