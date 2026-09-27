import type { Account, AccountType, Category, CategoryGroup, FinanceData, Line, Property, Settings, Transaction } from '../types';

// Categorical palette (fixed order). Series past the 8th fold to neutral.
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const NEUTRAL = '#a8a29e';
export const INCOME_COLOR = '#1baf7a';
export const SAVINGS_COLOR = '#0f8a5f';

export const ACCOUNT_TYPES: { id: AccountType; label: string; liability: boolean }[] = [
  { id: 'cash', label: 'Cash', liability: false },
  { id: 'investment', label: 'Investments', liability: false },
  { id: 'retirement', label: 'Retirement', liability: false },
  { id: 'property', label: 'Real estate', liability: false },
  { id: 'vehicle', label: 'Vehicles', liability: false },
  { id: 'other', label: 'Other assets', liability: false },
  { id: 'credit', label: 'Credit cards', liability: true },
  { id: 'mortgage', label: 'Mortgages', liability: true },
  { id: 'loan', label: 'Loans', liability: true },
];
export const isLiabilityType = (t: AccountType) => ACCOUNT_TYPES.find((x) => x.id === t)?.liability ?? false;

export function guessAccountType(a: Account): AccountType {
  const n = a.name.toLowerCase();
  if (/mortgage|heloc/.test(n)) return 'mortgage';
  if (/loan|nelnet|sallie|navient|mohela|financing/.test(n)) return 'loan';
  if (/card|credit|visa|amex|american express|sapphire|discover|mastercard|freedom|venture/.test(n)) return 'credit';
  if (/401|403|ira\b|roth|hsa|pension|retire|tsp/.test(n)) return 'retirement';
  if (/brokerage|invest|robinhood|fidelity|vanguard|schwab|e\*?trade|crypto|coinbase|stock/.test(n)) return 'investment';
  if (/\bcar\b|truck|vehicle|auto value|kbb/.test(n)) return 'vehicle';
  if (/home|house|property|real estate|zillow|value|condo|land/.test(n)) return 'property';
  if (!a.offBudget && a.balance < 0) return 'credit';
  return a.offBudget ? 'other' : 'cash';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Category groups whose name starts with a street number are treated as properties. */
export function guessProperties(data: FinanceData, accountTypes: Record<string, AccountType>): Property[] {
  const out: Property[] = [];
  for (const g of data.categoryGroups) {
    if (g.isIncome || !/^\d+\s+\S+/.test(g.name.trim())) continue;
    const key = norm(g.name);
    const short = key.split(' ').slice(0, 2).join(' ');
    const mentions = (name: string) => norm(name).includes(short);
    const incomeCats = data.categories.filter((c) => c.isIncome && mentions(c.name));
    out.push({
      id: g.id,
      name: g.name,
      categoryIds: [...data.categories.filter((c) => c.groupId === g.id).map((c) => c.id), ...incomeCats.map((c) => c.id)],
      valueAccountIds: data.accounts.filter((a) => accountTypes[a.id] === 'property' && mentions(a.name)).map((a) => a.id),
      loanAccountIds: data.accounts.filter((a) => (accountTypes[a.id] === 'mortgage' || accountTypes[a.id] === 'loan') && mentions(a.name)).map((a) => a.id),
      netOnly: incomeCats.length > 0,
    });
  }
  return out;
}

export function resolveSettings(data: FinanceData, saved: Partial<Settings> | null): Settings {
  const accountTypes: Record<string, AccountType> = {};
  for (const a of data.accounts) accountTypes[a.id] = saved?.accountTypes?.[a.id] ?? guessAccountType(a);
  const accountBanks: Record<string, string> = {};
  for (const a of data.accounts) {
    accountBanks[a.id] = saved?.accountBanks?.[a.id] ?? a.institution ?? '';
  }
  return {
    accountTypes,
    properties: saved?.properties ?? guessProperties(data, accountTypes),
    loanRates: saved?.loanRates ?? {},
    accountBanks,
  };
}

export type Model = ReturnType<typeof buildModel>;

export function buildModel(data: FinanceData, settings: Settings) {
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const catById = new Map<string, Category>(data.categories.map((c) => [c.id, c]));
  const groupById = new Map<string, CategoryGroup>(data.categoryGroups.map((g) => [g.id, g]));
  const propertyByCat = new Map<string, Property>();
  for (const p of settings.properties) for (const c of p.categoryIds) propertyByCat.set(c, p);

  // Transactions per account, newest first, for balance-at-date lookups.
  const txByAccount = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (!txByAccount.has(t.accountId)) txByAccount.set(t.accountId, []);
    txByAccount.get(t.accountId)!.push(t);
  }
  for (const list of txByAccount.values()) list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const earliest = data.transactions.reduce((m, t) => (t.date < m ? t.date : m), new Date().toISOString().slice(0, 10));

  const model = {
    data,
    settings,
    accountById,
    catById,
    groupById,
    propertyByCat,
    earliest,
    accountType: (id: string): AccountType => settings.accountTypes[id] ?? 'other',
    bankOf: (id: string) => settings.accountBanks[id]?.trim() || '',
    /** "Kinecta · Savings", or just the name when no bank is set or the name already says it. */
    accountLabel(id: string) {
      const a = accountById.get(id);
      if (!a) return 'Unknown account';
      const bank = settings.accountBanks[id]?.trim();
      return bank && !a.name.toLowerCase().includes(bank.toLowerCase()) ? `${bank} · ${a.name}` : a.name;
    },
    categoryName: (id: string | null) => (id ? catById.get(id)?.name ?? 'Unknown' : 'Uncategorized'),
    groupOf: (catId: string | null) => (catId ? groupById.get(catById.get(catId)?.groupId ?? '') : undefined),
    balanceAt(accountId: string, date: string) {
      const a = accountById.get(accountId);
      if (!a) return 0;
      let b = a.balance;
      for (const t of txByAccount.get(accountId) ?? []) {
        if (t.date <= date) break;
        b -= t.amount;
      }
      return b;
    },
    colorOf: (_key: string) => NEUTRAL,
  };

  // Stable colors: rank spending groups (and net-only properties) by all-time size.
  const totals = new Map<string, number>();
  for (const l of flowLines(model, '0000-01-01', '9999-12-31')) {
    const k = lineKey(model, l);
    if (k.kind === 'expense' || k.kind === 'property') totals.set(k.colorKey, (totals.get(k.colorKey) ?? 0) + Math.abs(l.amount));
  }
  const ranked = [...totals.entries()].filter(([k]) => k !== 'uncategorized').sort((a, b) => b[1] - a[1]);
  const colors = new Map(ranked.map(([k], i) => [k, PALETTE[i] ?? NEUTRAL]));
  model.colorOf = (key: string) => colors.get(key) ?? NEUTRAL;
  return model;
}

/** Lines that count as real income/spending: on-budget, not transfers, splits expanded. */
export function flowLines(model: { accountById: Map<string, Account>; data: FinanceData }, start: string, end: string, filter?: (t: Transaction) => boolean): Line[] {
  const out: Line[] = [];
  for (const t of model.data.transactions) {
    if (t.date < start || t.date > end || t.startingBalance) continue;
    const acct = model.accountById.get(t.accountId);
    if (!acct || acct.offBudget) continue;
    if (t.transferAccountId && !t.categoryId && !t.splits) continue;
    if (filter && !filter(t)) continue;
    if (t.splits) for (const s of t.splits) out.push({ tx: t, categoryId: s.categoryId, amount: s.amount });
    else out.push({ tx: t, categoryId: t.categoryId, amount: t.amount });
  }
  return out;
}

export type LineKey =
  | { kind: 'income'; key: string; colorKey: string }
  | { kind: 'expense'; key: string; groupId: string; colorKey: string }
  | { kind: 'property'; key: string; property: Property; colorKey: string };

export function lineKey(model: Pick<Model, 'catById' | 'propertyByCat'>, l: Line): LineKey {
  const prop = l.categoryId ? model.propertyByCat.get(l.categoryId) : undefined;
  if (prop?.netOnly) return { kind: 'property', key: 'prop:' + prop.id, property: prop, colorKey: 'prop:' + prop.id };
  if (!l.categoryId) {
    return l.amount >= 0
      ? { kind: 'income', key: 'uncategorized-income', colorKey: 'uncategorized' }
      : { kind: 'expense', key: 'uncategorized', groupId: 'uncategorized', colorKey: 'uncategorized' };
  }
  const cat = model.catById.get(l.categoryId);
  if (!cat) return { kind: 'expense', key: l.categoryId, groupId: 'uncategorized', colorKey: 'uncategorized' };
  if (cat.isIncome) return { kind: 'income', key: cat.id, colorKey: 'income' };
  return { kind: 'expense', key: cat.id, groupId: cat.groupId, colorKey: 'group:' + cat.groupId };
}
