import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoData } from './demo.mjs';
import {
  actualConfigured,
  createCategory,
  createCategoryGroup,
  deleteCategory,
  deleteCategoryGroup,
  loadActualData,
  makeTransfer,
  moveCategory,
  renameCategory,
  renameCategoryGroup,
  setPayeeCategoryRule,
  setTransactionCategories,
  setTransactionCategory,
  syncActual,
  syncBanks,
} from './actual.mjs';
import { badRequest, checkDeleteTarget, cleanName, demoEdits, reconcileProperties } from './categories.mjs';
import { aiConfigured, suggestCategories } from './ai.mjs';
import { applyTransferLocally, counterpartIndex, findCounterpart } from './transfers.mjs';

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

/**
 * Marks each transaction as a transfer to the given account, linking the matching transaction on that account.
 * When that account has no matching transaction, Actual would add one there, so that only happens for items
 * with create: true (the person confirmed it); the rest are skipped and returned as unmatched.
 */
async function markTransfers(list) {
  const data = await getData();
  const byId = new Map(data.transactions.map((t) => [t.id, t]));
  const accounts = new Set(data.accounts.filter((a) => !a.closed).map((a) => a.id));
  const index = counterpartIndex(data);
  const used = new Set();
  let linked = 0;
  const unmatched = [];
  let written = 0;
  for (const { txId, accountId, create } of list) {
    const tx = byId.get(txId);
    if (!tx) throw new Error('Transaction not found; refresh and try again');
    if (!accounts.has(accountId) || accountId === tx.accountId) throw new Error('Pick a different open account to transfer to');
    // Already a transfer, or just linked as the other side of an earlier one in this list.
    if (tx.transferAccountId || tx.splits || used.has(tx.id)) continue;
    const counterpart = findCounterpart(index, tx, accountId, used);
    if (!counterpart && !create) {
      unmatched.push(txId);
      continue;
    }
    used.add(tx.id);
    if (counterpart) {
      used.add(counterpart.id);
      linked++;
    }
    written++;
    if (DEMO) applyTransferLocally(data, tx, accountId, counterpart);
    else await makeTransfer({ txId, fromAccountId: tx.accountId, toAccountId: accountId, counterpartId: counterpart?.id ?? null });
  }
  if (!DEMO && written) {
    await syncActual();
    await getData(true);
  }
  return { linked, created: written - linked, unmatched };
}

const transferList = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .filter((x) => x && typeof x.txId === 'string' && typeof x.accountId === 'string')
    .map((x) => ({ txId: x.txId, accountId: x.accountId, create: x.create === true }));

app.post('/api/transactions/:id/transfer', async (req, res) => {
  try {
    const r = await markTransfers(transferList([{ txId: req.params.id, accountId: req.body?.accountId, create: req.body?.create }]));
    if (r.unmatched.length) return res.json({ ok: false, needsConfirm: true });
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error('Marking transfer failed:', err);
    res.status(502).json({ error: String(err?.message || err) });
  }
});

/**
 * Bulk edit from the Transactions page: one category (or null for uncategorized) for many
 * transactions, or all of them marked as transfers to one account. Splits and starting balances
 * are skipped, as are transfers when setting a transfer (they're already linked) and transactions
 * already in the target account. A transfer with no matching transaction on the other account only
 * goes through with create: true; otherwise it comes back in `unmatched` so the UI can ask first.
 */
app.post('/api/transactions/bulk', async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.txIds) ? req.body.txIds : []).filter((x) => typeof x === 'string'))];
  const transferTo = typeof req.body?.transferAccountId === 'string' ? req.body.transferAccountId : null;
  const categoryId = transferTo ? null : (req.body?.categoryId ?? null);
  try {
    const data = await getData();
    const byId = new Map(data.transactions.map((t) => [t.id, t]));
    if (categoryId !== null && !data.categories.some((c) => c.id === categoryId)) throw badRequest('Category not found; refresh and try again');
    if (transferTo && !data.accounts.some((a) => a.id === transferTo && !a.closed)) throw badRequest('Pick an open account to transfer to');
    const txs = ids.map((id) => byId.get(id)).filter(Boolean);
    const ok = txs.filter((t) => !t.splits && !t.startingBalance && (transferTo ? !t.transferAccountId && t.accountId !== transferTo : true));
    const skipped = ids.length - ok.length;

    if (transferTo) {
      const r = await markTransfers(ok.map((t) => ({ txId: t.id, accountId: transferTo, create: req.body?.create === true })));
      return res.json({ ok: true, updated: r.linked + r.created, linked: r.linked, created: r.created, unmatched: r.unmatched, skipped });
    }
    const changes = ok.filter((t) => t.categoryId !== categoryId).map((t) => ({ txId: t.id, categoryId }));
    if (changes.length && !DEMO) await setTransactionCategories(changes);
    for (const c of changes) byId.get(c.txId).categoryId = c.categoryId;
    res.json({ ok: true, updated: changes.length, skipped });
  } catch (err) {
    console.error('Bulk edit failed:', err);
    res.status(err.status ?? 502).json({ error: String(err?.message || err) });
  }
});

// ---- categories and category groups (written to Actual) ----

/**
 * Runs a category edit against Actual (or the demo data), reloads, and keeps saved property
 * settings in step. `edit` gets the current data and returns the id of anything it created.
 */
async function editCategories(res, edit) {
  try {
    const data = await getData();
    const before = { categoryGroups: structuredClone(data.categoryGroups), categories: structuredClone(data.categories) };
    const id = await edit(data);
    const after = DEMO ? data : await getData(true);
    const settings = reconcileProperties(readSettings(), before, after);
    if (settings) fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json({ ok: true, id: id ?? null });
  } catch (err) {
    console.error('Category change failed:', err);
    res.status(err.status ?? 502).json({ error: String(err?.message || err) });
  }
}

function findGroup(data, id) {
  const g = data.categoryGroups.find((x) => x.id === id);
  if (!g) throw badRequest('Category group not found; refresh and try again');
  return g;
}
function findCategory(data, id) {
  const c = data.categories.find((x) => x.id === id);
  if (!c) throw badRequest('Category not found; refresh and try again');
  return c;
}

app.post('/api/category-groups', (req, res) =>
  editCategories(res, (data) => {
    const name = cleanName(req.body?.name);
    return DEMO ? demoEdits.createGroup(data, name) : createCategoryGroup(name);
  }),
);

app.patch('/api/category-groups/:id', (req, res) =>
  editCategories(res, async (data) => {
    const g = findGroup(data, req.params.id);
    const name = cleanName(req.body?.name);
    if (name === g.name) return;
    if (DEMO) demoEdits.renameGroup(data, g.id, name);
    else await renameCategoryGroup(g.id, name);
  }),
);

app.delete('/api/category-groups/:id', (req, res) =>
  editCategories(res, async (data) => {
    const g = findGroup(data, req.params.id);
    if (g.isIncome) throw badRequest("The income group can't be deleted");
    const ids = data.categories.filter((c) => c.groupId === g.id).map((c) => c.id);
    const target = checkDeleteTarget(data, ids, req.body?.transferCategoryId, false);
    if (DEMO) demoEdits.deleteGroup(data, g.id, target);
    else await deleteCategoryGroup(g.id, target);
  }),
);

app.post('/api/categories', (req, res) =>
  editCategories(res, (data) => {
    const g = findGroup(data, req.body?.groupId);
    const name = cleanName(req.body?.name);
    return DEMO ? demoEdits.createCategory(data, name, g.id, g.isIncome) : createCategory(name, g.id, g.isIncome);
  }),
);

app.patch('/api/categories/:id', (req, res) =>
  editCategories(res, async (data) => {
    const c = findCategory(data, req.params.id);
    if (req.body?.name !== undefined) {
      const name = cleanName(req.body.name);
      if (name !== c.name) {
        if (DEMO) demoEdits.renameCategory(data, c.id, name);
        else await renameCategory(c.id, name);
      }
    }
    if (req.body?.groupId !== undefined && req.body.groupId !== c.groupId) {
      const g = findGroup(data, req.body.groupId);
      if (g.isIncome !== c.isIncome) throw badRequest('Income categories can only move to the income group');
      if (DEMO) demoEdits.moveCategory(data, c.id, g.id);
      else await moveCategory(c.id, g.id);
    }
  }),
);

app.delete('/api/categories/:id', (req, res) =>
  editCategories(res, async (data) => {
    const c = findCategory(data, req.params.id);
    const target = checkDeleteTarget(data, [c.id], req.body?.transferCategoryId, c.isIncome);
    if (DEMO) demoEdits.deleteCategory(data, c.id, target);
    else await deleteCategory(c.id, target);
  }),
);

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
  const transfers = transferList(req.body?.transfers);
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
      const x = await markTransfers(transfers);
      return res.json({ ok: true, updated: changes.length, transfers: x.linked + x.created, unmatched: x.unmatched.length, rules: rules.length - rulesFailed, rulesFailed });
    }
    changes.forEach((c) => byId.get(c.txId) && (byId.get(c.txId).categoryId = c.categoryId));
    const x = await markTransfers(transfers);
    res.json({ ok: true, updated: changes.length, transfers: x.linked + x.created, unmatched: x.unmatched.length, rules: 0, rulesFailed: 0 });
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
