import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoData } from './demo.mjs';
import { actualConfigured, loadActualData, setPayeeCategoryRule, setTransactionCategories, setTransactionCategory, syncActual, syncBanks } from './actual.mjs';
import { aiConfigured, suggestCategories } from './ai.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || './data';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CACHE_MS = Number(process.env.CACHE_SECONDS || 60) * 1000;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const DEMO = process.env.DEMO_MODE === 'true' || !actualConfigured();

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- auth (optional, single shared password) ----
const secret = (() => {
  const f = path.join(DATA_DIR, '.session-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
})();
const sign = (v) => crypto.createHmac('sha256', secret).update(v).digest('hex');
const token = () => {
  const exp = String(Date.now() + 30 * 86400000);
  return `${exp}.${sign(exp + APP_PASSWORD)}`;
};
const validToken = (t) => {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp + APP_PASSWORD);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};
const cookie = (req, name) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];

// ---- data ----
let cache = null;
let cacheAt = 0;
let demoData = null;
let lastBankSync = null;

async function getData(force = false) {
  if (DEMO) {
    demoData ??= buildDemoData();
    return demoData;
  }
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  cache = await loadActualData();
  cacheAt = Date.now();
  return cache;
}

const readSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return null;
  }
};

// ---- app ----
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/session', (req, res) => {
  res.json({ authRequired: Boolean(APP_PASSWORD), authenticated: !APP_PASSWORD || validToken(cookie(req, 'bf_session')), demo: DEMO, ai: aiConfigured() });
});

app.post('/api/login', (req, res) => {
  const given = String(req.body?.password || '');
  const ok =
    APP_PASSWORD &&
    given.length === APP_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(APP_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'Wrong password' });
  res.setHeader('Set-Cookie', `bf_session=${token()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'bf_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (!APP_PASSWORD || validToken(cookie(req, 'bf_session'))) return next();
  res.status(401).json({ error: 'Not signed in' });
});

app.get('/api/data', async (req, res) => {
  try {
    const data = await getData(req.query.refresh === '1');
    res.json({ ...data, meta: { ...data.meta, lastBankSync } });
  } catch (err) {
    console.error('Failed to load data from Actual:', err);
    res.status(502).json({ error: 'Could not load data from Actual Budget: ' + (err?.message || err) });
  }
});

app.post('/api/sync', async (_req, res) => {
  try {
    if (!DEMO) await syncBanks();
    lastBankSync = new Date().toISOString();
    await getData(true);
    res.json({ ok: true, lastBankSync });
  } catch (err) {
    console.error('Bank sync failed:', err);
    res.status(502).json({ error: 'Bank sync failed: ' + (err?.message || err) });
  }
});

app.patch('/api/transactions/:id', async (req, res) => {
  const categoryId = req.body?.categoryId ?? null;
  try {
    if (DEMO) {
      const t = demoData?.transactions.find((x) => x.id === req.params.id);
      if (t) t.categoryId = categoryId;
    } else {
      await setTransactionCategory(req.params.id, categoryId);
      if (cache) {
        const t = cache.transactions.find((x) => x.id === req.params.id);
        if (t) t.categoryId = categoryId;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
});

// ---- AI categorization: suggest, then the user reviews and applies ----
app.post('/api/ai/suggest', async (req, res) => {
  const ids = Array.isArray(req.body?.txIds) ? req.body.txIds.map(String) : [];
  try {
    res.json(await suggestCategories(await getData(), ids));
  } catch (err) {
    console.error('AI suggest failed:', err);
    res.status(502).json({ error: String(err?.message || err) });
  }
});

app.post('/api/ai/apply', async (req, res) => {
  const changes = (Array.isArray(req.body?.changes) ? req.body.changes : [])
    .filter((c) => c && typeof c.txId === 'string' && typeof c.categoryId === 'string')
    .map((c) => ({ txId: c.txId, categoryId: c.categoryId }));
  const rules = (Array.isArray(req.body?.rules) ? req.body.rules : []).filter((r) => r && typeof r.payeeId === 'string' && typeof r.categoryId === 'string');
  try {
    const data = await getData();
    const byId = new Map(data.transactions.map((t) => [t.id, t]));
    if (!DEMO) {
      await setTransactionCategories(changes);
      let rulesFailed = 0;
      for (const r of rules) {
        try {
          await setPayeeCategoryRule(r.payeeId, r.categoryId);
        } catch (err) {
          rulesFailed++;
          console.error('Could not create rule for payee', r.payeeId, err);
        }
      }
      if (rules.length) await syncActual();
      changes.forEach((c) => byId.get(c.txId) && (byId.get(c.txId).categoryId = c.categoryId));
      return res.json({ ok: true, updated: changes.length, rules: rules.length - rulesFailed, rulesFailed });
    }
    changes.forEach((c) => byId.get(c.txId) && (byId.get(c.txId).categoryId = c.categoryId));
    res.json({ ok: true, updated: changes.length, rules: 0, rulesFailed: 0 });
  } catch (err) {
    console.error('AI apply failed:', err);
    res.status(502).json({ error: String(err?.message || err) });
  }
});

app.get('/api/settings', (_req, res) => res.json(readSettings()));
app.put('/api/settings', (req, res) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Butterfly listening on :${PORT} (${DEMO ? 'demo data' : 'Actual Budget at ' + process.env.ACTUAL_SERVER_URL})`);
});
