// Finds the other side of a transfer between two of the household's accounts
// (a card payment shows up as money out of checking and money in on the card).
// Marking a transaction as a transfer links it to that counterpart instead of
// letting Actual create a duplicate.

const MAX_DAYS = 5;
const toCents = (n) => Math.round(n * 100);
const dayGap = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

// Words banks use on payments and transfers between your own accounts.
export const TRANSFER_WORDS = /\b(payment|pmt|autopay|auto pay|crcardpmt|epay|e-payment|thank you|transfer|xfer|trnsfr|online banking|mobile pmt|ach pmt)\b/i;

/** Transactions that could still be one side of a transfer, indexed by amount in cents. */
export function counterpartIndex(data) {
  const open = new Set(data.accounts.filter((a) => !a.closed).map((a) => a.id));
  const byAmount = new Map();
  for (const t of data.transactions) {
    if (!open.has(t.accountId) || t.transferAccountId || t.splits || t.startingBalance || !t.amount) continue;
    const k = toCents(t.amount);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(t);
  }
  return byAmount;
}

/** The closest-dated transaction in another account (or in toAccountId) for the opposite amount, within a few days. */
export function findCounterpart(index, tx, toAccountId = null, used = new Set()) {
  let best = null;
  for (const t of index.get(-toCents(tx.amount)) ?? []) {
    if (t.id === tx.id || t.accountId === tx.accountId || used.has(t.id)) continue;
    if (toAccountId && t.accountId !== toAccountId) continue;
    const gap = dayGap(t.date, tx.date);
    if (gap > MAX_DAYS || (best && gap >= best.gap)) continue;
    best = { t, gap };
  }
  return best?.t ?? null;
}

/** Demo mode: mirror what Actual does when a transaction becomes a transfer. */
export function applyTransferLocally(data, tx, toAccountId, counterpart) {
  const fromName = data.accounts.find((a) => a.id === tx.accountId)?.name ?? '';
  tx.transferAccountId = toAccountId;
  tx.categoryId = null;
  if (counterpart) {
    counterpart.transferAccountId = tx.accountId;
    counterpart.categoryId = null;
  } else {
    const to = data.accounts.find((a) => a.id === toAccountId);
    if (to) to.balance = Math.round((to.balance - tx.amount) * 100) / 100;
    data.transactions.push({
      ...tx,
      id: tx.id + '-xfer',
      accountId: toAccountId,
      amount: -tx.amount,
      payee: fromName,
      payeeId: null,
      transferAccountId: tx.accountId,
      cleared: false,
    });
  }
}
