import type { Line, Transaction } from '../types';
import { endOfMonth, monthKey, monthsBetween } from './format';
import { flowLines, INCOME_COLOR, isLiabilityType, lineKey, NEUTRAL, type Model } from './model';

export type Item = {
  key: string;
  label: string;
  amount: number; // positive = income for income items, positive = spend for expense items
  color: string;
  kind: 'category' | 'group' | 'property' | 'merchant';
  propertyId?: string;
  children?: Item[];
  count?: number;
};

const sortDesc = (items: Item[]) => items.sort((a, b) => b.amount - a.amount);

export function summarize(model: Model, lines: Line[]) {
  const income = new Map<string, Item>();
  const groups = new Map<string, Item & { children: Item[] }>();
  const cats = new Map<string, Item>();

  for (const l of lines) {
    const k = lineKey(model, l);
    if (k.kind === 'property') {
      // Net-only property: one bucket, placed on the income or expense side by its net.
      const g = groups.get(k.key) ?? { key: k.key, label: k.property.name, amount: 0, color: model.colorOf(k.colorKey), kind: 'property', propertyId: k.property.id, children: [] };
      g.amount -= l.amount;
      groups.set(k.key, g);
    } else if (k.kind === 'income') {
      const it = income.get(k.key) ?? { key: k.key, label: model.categoryName(l.categoryId), amount: 0, color: INCOME_COLOR, kind: 'category', count: 0 };
      it.amount += l.amount;
      it.count!++;
      income.set(k.key, it);
    } else {
      const gid = k.groupId;
      const g =
        groups.get(gid) ??
        ({ key: gid, label: gid === 'uncategorized' ? 'Uncategorized' : model.groupById.get(gid)?.name ?? 'Other', amount: 0, color: model.colorOf(k.colorKey), kind: 'group', children: [] } as Item & { children: Item[] });
      groups.set(gid, g);
      g.amount -= l.amount;
      const c = cats.get(k.key) ?? { key: k.key, label: model.categoryName(l.categoryId), amount: 0, color: g.color, kind: 'category', count: 0 };
      if (!cats.has(k.key)) g.children.push(c);
      c.amount -= l.amount;
      c.count!++;
      cats.set(k.key, c);
    }
  }

  // Net-only properties that made money move to the income side.
  const expenses: Item[] = [];
  for (const g of groups.values()) {
    if (g.kind === 'property' && g.amount < 0) income.set(g.key, { ...g, amount: -g.amount, children: undefined });
    else expenses.push(g);
  }
  for (const g of expenses) if (g.children) sortDesc(g.children);
  const incomeItems = sortDesc([...income.values()]);
  const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
  const totalExpenses = expenses.reduce((s, i) => s + i.amount, 0);
  return {
    income: incomeItems,
    expenses: sortDesc(expenses),
    categories: sortDesc([...cats.values()].filter((c) => c.amount !== 0)),
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
  };
}

export function merchants(model: Model, lines: Line[]): Item[] {
  const m = new Map<string, Item>();
  for (const l of lines) {
    const k = lineKey(model, l);
    if (k.kind !== 'expense') continue;
    const name = l.tx.payee || 'Unknown';
    const it = m.get(name) ?? { key: name, label: name, amount: 0, color: NEUTRAL, kind: 'merchant', count: 0 };
    it.amount -= l.amount;
    it.count!++;
    m.set(name, it);
  }
  return sortDesc([...m.values()].filter((i) => i.amount > 0));
}

export type MonthRow = { month: string; income: number; expenses: number; net: number };

export function monthly(model: Model, start: string, end: string, filter?: (t: Transaction) => boolean): MonthRow[] {
  const months = monthsBetween(start, end);
  const rows = new Map(months.map((m) => [m, { month: m, income: 0, expenses: 0, net: 0 }]));
  for (const l of flowLines(model, start, end, filter)) {
    const row = rows.get(monthKey(l.tx.date));
    if (!row) continue;
    const k = lineKey(model, l);
    if (k.kind === 'income') row.income += l.amount;
    else if (k.kind === 'property') {
      if (l.amount > 0) row.income += l.amount;
      else row.expenses -= l.amount;
    } else row.expenses -= l.amount;
  }
  for (const r of rows.values()) r.net = r.income - r.expenses;
  return [...rows.values()];
}

/** Monthly spend per key (group id or category id) for trend charts. */
export function monthlyBy(model: Model, start: string, end: string, keyOf: (l: Line) => string | null) {
  const months = monthsBetween(start, end);
  const rows = new Map(months.map((m) => [m, { month: m } as Record<string, number | string>]));
  for (const l of flowLines(model, start, end)) {
    const key = keyOf(l);
    if (!key) continue;
    const row = rows.get(monthKey(l.tx.date));
    if (!row) continue;
    row[key] = ((row[key] as number) ?? 0) - l.amount;
  }
  return [...rows.values()];
}

export function netWorthAt(model: Model, date: string) {
  let assets = 0;
  let liabilities = 0;
  for (const a of model.data.accounts) {
    const b = model.balanceAt(a.id, date);
    if (isLiabilityType(model.accountType(a.id)) || b < 0) liabilities += -b;
    else assets += b;
  }
  return { assets, liabilities, net: assets - liabilities };
}

export function balanceSeries(model: Model, accountIds: string[], start: string, end: string) {
  const s = start < model.earliest ? model.earliest : start;
  return monthsBetween(s, end).map((m) => {
    const d = endOfMonth(m) > end ? end : endOfMonth(m);
    return { month: m, date: d, value: accountIds.reduce((sum, id) => sum + model.balanceAt(id, d), 0) };
  });
}

export const inRange = (t: Transaction, start: string, end: string) => t.date >= start && t.date <= end;

export const isUncategorized = (model: Model, t: Transaction) => {
  const acct = model.accountById.get(t.accountId);
  return !!acct && !acct.offBudget && !t.startingBalance && !t.transferAccountId && !t.categoryId && !t.splits;
};
