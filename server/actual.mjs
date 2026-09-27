// Reads a budget from a self-hosted Actual Budget server and normalizes it
// into the shape the Butterfly UI consumes (see src/types.ts).
import fs from 'node:fs';
import path from 'node:path';

let api = null;
// The budget's own message handlers. api.updateTransaction returns before Actual finishes
// its transfer bookkeeping, so transfers go through the awaited batch update instead.
let internal = null;
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
    internal = await api.init({ dataDir: c.dataDir, serverURL: c.serverURL, password: c.password });
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
  // Bank names aren't in the public account model; the internal handler joins them in.
  const bankById = new Map();
  try {
    const internal = (api.default ?? api).internal;
    for (const a of (await internal?.send('accounts-get')) ?? []) if (a.bankName) bankById.set(a.id, a.bankName);
  } catch {
    /* older Actual versions: fall back to names only */
  }
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
      institution: bankById.get(a.id) || null,
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
        // A transfer's payee is the other account; the bank's own description says more.
        payee: (transferAccountId && t.imported_payee) || payee?.name || t.imported_payee || '',
        payeeId: t.payee || null,
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

  // Newest first across all accounts, like the demo data; the UI groups consecutive rows by day.
  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

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

export async function setTransactionCategories(changes) {
  await connect();
  for (const { txId, categoryId } of changes) await api.updateTransaction(txId, { category: categoryId });
  await api.sync();
}

/** Makes Actual categorize this payee's future transactions automatically. Reuses an existing payee-to-category rule when there is one. */
export async function setPayeeCategoryRule(payeeId, categoryId) {
  await connect();
  const rules = await api.getPayeeRules(payeeId);
  const existing = rules.find(
    (r) =>
      r.conditions?.length === 1 &&
      r.conditions[0].field === 'payee' &&
      r.conditions[0].op === 'is' &&
      r.actions?.length === 1 &&
      r.actions[0].op === 'set' &&
      r.actions[0].field === 'category',
  );
  if (existing) {
    if (existing.actions[0].value !== categoryId) await api.updateRule({ ...existing, actions: [{ ...existing.actions[0], value: categoryId }] });
  } else {
    await api.createRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [{ field: 'payee', op: 'is', value: payeeId }],
      actions: [{ op: 'set', field: 'category', value: categoryId }],
    });
  }
}

/**
 * Turns a transaction into a transfer to another account. With a counterpart (the same money
 * already imported on the other account) the two are linked; otherwise Actual creates the other side.
 * Actual clears the category when both accounts are on budget.
 */
export async function makeTransfer({ txId, fromAccountId, toAccountId, counterpartId = null }) {
  await connect();
  const [payees, accounts] = await Promise.all([api.getPayees(), api.getAccounts()]);
  const payeeOf = (acct) => payees.find((p) => p.transfer_acct === acct)?.id;
  const toPayee = payeeOf(toAccountId);
  const fromPayee = payeeOf(fromAccountId);
  if (!toPayee || !fromPayee) throw new Error('Actual has no transfer payee for one of these accounts');
  if (counterpartId) {
    // Link the pair directly, the way Actual's "Make transfer" does, but without its
    // follow-up step that would copy each side's notes over the other's.
    const offBudget = (id) => Boolean(accounts.find((a) => a.id === id)?.offbudget);
    const clear = offBudget(fromAccountId) === offBudget(toAccountId) ? { category: null } : {};
    await internal.send('transactions-batch-update', {
      updated: [
        { id: txId, payee: toPayee, transfer_id: counterpartId, ...clear },
        { id: counterpartId, payee: fromPayee, transfer_id: txId, ...clear },
      ],
      runTransfers: false,
    });
  } else {
    await internal.send('transactions-batch-update', { updated: [{ id: txId, payee: toPayee }] });
  }
}

export async function syncActual() {
  await connect();
  await api.sync();
}

// ---- categories and category groups ----

export async function createCategoryGroup(name) {
  await connect();
  const id = await api.createCategoryGroup({ name, is_income: false, hidden: false });
  await api.sync();
  return id;
}

// Actual's update fills any field left out with its default (unhiding, or turning an income
// group into an expense one), so renames send the whole current record.
export async function renameCategoryGroup(id, name) {
  await connect();
  const g = (await api.getCategoryGroups()).find((x) => x.id === id);
  if (!g) throw new Error('Category group not found; refresh and try again');
  await api.updateCategoryGroup(id, { name, is_income: g.is_income, hidden: g.hidden });
  await api.sync();
}

/** Deletes a group and its categories; their transactions move to transferCategoryId. */
export async function deleteCategoryGroup(id, transferCategoryId) {
  await connect();
  await api.deleteCategoryGroup(id, transferCategoryId || undefined);
  await api.sync();
}

export async function createCategory(name, groupId, isIncome) {
  await connect();
  const id = await api.createCategory({ name, group_id: groupId, is_income: isIncome, hidden: false });
  await api.sync();
  return id;
}

export async function renameCategory(id, name) {
  await connect();
  const c = (await api.getCategories()).find((x) => x.id === id);
  if (!c) throw new Error('Category not found; refresh and try again');
  await api.updateCategory(id, { name, group_id: c.group_id, is_income: c.is_income, hidden: c.hidden });
  await api.sync();
}

/** Moves a category to the end of another group (Actual's own move, which keeps the sort order valid). */
export async function moveCategory(id, groupId) {
  await connect();
  await internal.send('category-move', { id, groupId, targetId: null });
  await api.sync();
}

/** Deletes a category; its transactions (and rules) move to transferCategoryId. */
export async function deleteCategory(id, transferCategoryId) {
  await connect();
  await api.deleteCategory(id, transferCategoryId || undefined);
  await api.sync();
}
