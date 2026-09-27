// Reads a budget from a self-hosted Actual Budget server and normalizes it
// into the shape the Butterfly UI consumes (see src/types.ts).
import fs from 'node:fs';
import path from 'node:path';

let api = null;
let ready = null;

const cfg = () => ({
  serverURL: process.env.ACTUAL_SERVER_URL,
  password: process.env.ACTUAL_PASSWORD,
  syncId: process.env.ACTUAL_SYNC_ID,
  encryptionPassword: process.env.ACTUAL_ENCRYPTION_PASSWORD || undefined,
  dataDir: path.join(process.env.DATA_DIR || './data', 'actual-cache'),
});

export const actualConfigured = () => {
  const c = cfg();
  return Boolean(c.serverURL && c.password && c.syncId);
};

async function connect() {
  if (ready) return ready;
  ready = (async () => {
    const c = cfg();
    fs.mkdirSync(c.dataDir, { recursive: true });
    api = await import('@actual-app/api');
    await api.init({ dataDir: c.dataDir, serverURL: c.serverURL, password: c.password });
    await api.downloadBudget(c.syncId, c.encryptionPassword ? { password: c.encryptionPassword } : undefined);
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

const cents = (n) => Math.round(n ?? 0) / 100;

export async function syncBanks() {
  await connect();
  await api.runBankSync();
  await api.sync();
}

export async function loadActualData() {
  await connect();
  await api.sync();

  const [accounts, groups, categories, payees] = await Promise.all([
    api.getAccounts(),
    api.getCategoryGroups(),
    api.getCategories(),
    api.getPayees(),
  ]);
  const payeeById = new Map(payees.map((p) => [p.id, p]));
  const today = new Date().toISOString().slice(0, 10);

  const outAccounts = [];
  const transactions = [];
  for (const a of accounts) {
    const balance = await api.getAccountBalance(a.id);
    outAccounts.push({
      id: a.id,
      name: a.name,
      offBudget: Boolean(a.offbudget),
      closed: Boolean(a.closed),
      balance: cents(balance),
    });

    const txs = await api.getTransactions(a.id, '1970-01-01', today);
    for (const t of txs) {
      if (t.is_child || t.tombstone) continue;
      const payee = t.payee ? payeeById.get(t.payee) : null;
      const transferAccountId = payee?.transfer_acct || null;
      const subs = (t.subtransactions || []).filter((s) => !s.tombstone);
      transactions.push({
        id: t.id,
        date: t.date,
        accountId: a.id,
        amount: cents(t.amount),
        payee: payee?.name || t.imported_payee || '',
        categoryId: subs.length ? null : t.category || null,
        notes: t.notes || '',
        transferAccountId,
        startingBalance: Boolean(t.starting_balance_flag),
        cleared: Boolean(t.cleared),
        splits: subs.length
          ? subs.map((s) => ({ categoryId: s.category || null, amount: cents(s.amount), notes: s.notes || '' }))
          : undefined,
      });
    }
  }

  return {
    meta: { source: 'actual', syncedAt: new Date().toISOString() },
    accounts: outAccounts,
    categoryGroups: groups.map((g) => ({ id: g.id, name: g.name, isIncome: Boolean(g.is_income), hidden: Boolean(g.hidden) })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, groupId: c.group_id, isIncome: Boolean(c.is_income), hidden: Boolean(c.hidden) })),
    transactions,
  };
}

export async function setTransactionCategory(id, categoryId) {
  await connect();
  await api.updateTransaction(id, { category: categoryId });
  await api.sync();
}
