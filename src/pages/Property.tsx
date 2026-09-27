import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Home } from 'lucide-react';
import { useStore } from '../store';
import type { Item } from '../lib/finance';
import { flowLines, INCOME_COLOR, PALETTE, NEUTRAL } from '../lib/model';
import { money, moneyCompact, monthKey, monthLabel, monthsBetween, pct } from '../lib/format';
import { BarList, Card, ChartTooltip, PageHeader, Stat } from '../components/ui';
import { TxList } from '../components/TxList';
import { EXPENSE_COLOR } from './CashFlow';

export function PropertyPage() {
  const { id = '' } = useParams();
  const { model, period } = useStore();
  const property = model.settings.properties.find((p) => p.id === id);

  const data = useMemo(() => {
    if (!property) return null;
    const cats = new Set(property.categoryIds);
    const lines = flowLines(model, period.start, period.end).filter((l) => l.categoryId && cats.has(l.categoryId));
    const months = new Map(monthsBetween(period.start, period.end).map((m) => [m, { month: m, income: 0, expenses: 0, net: 0 }]));
    const byCat = new Map<string, Item>();
    let income = 0;
    let expenses = 0;
    for (const l of lines) {
      const isIncome = model.catById.get(l.categoryId!)?.isIncome;
      const row = months.get(monthKey(l.tx.date));
      if (isIncome) {
        income += l.amount;
        if (row) row.income += l.amount;
      } else {
        expenses -= l.amount;
        if (row) row.expenses -= l.amount;
        const it = byCat.get(l.categoryId!) ?? { key: l.categoryId!, label: model.categoryName(l.categoryId), amount: 0, color: NEUTRAL, kind: 'category' as const };
        it.amount -= l.amount;
        byCat.set(l.categoryId!, it);
      }
    }
    for (const r of months.values()) r.net = r.income - r.expenses;
    const expenseItems = [...byCat.values()].sort((a, b) => b.amount - a.amount).map((it, i) => ({ ...it, color: PALETTE[i] ?? NEUTRAL }));
    const txIds = new Set(lines.map((l) => l.tx.id));
    const txs = model.data.transactions.filter((t) => txIds.has(t.id));
    const value = property.valueAccountIds.reduce((s, a) => s + model.balanceAt(a, period.end), 0);
    const debt = -property.loanAccountIds.reduce((s, a) => s + model.balanceAt(a, period.end), 0);
    return { income, expenses, net: income - expenses, months: [...months.values()], expenseItems, txs, value, debt };
  }, [model, period, property]);

  if (!property || !data) return <div className="page"><p>Property not found. Check <Link to="/settings">Settings</Link>.</p></div>;
  const n = data.months.length || 1;
  const hasValue = property.valueAccountIds.length > 0;

  return (
    <div className="page">
      <PageHeader title={property.name} icon={<Home size={20} />} />
      <div className="stats">
        <Stat label="Net cash flow" value={money(data.net)} tone={data.net >= 0 ? 'pos' : 'neg'} sub={`${money(data.net / n)} / month`} />
        <Stat label="Income" dot={INCOME_COLOR} value={money(data.income)} />
        <Stat label="Expenses" dot={EXPENSE_COLOR} value={money(data.expenses)} />
        {hasValue ? (
          <Stat label="Equity" value={money(data.value - data.debt)} sub={`${money(data.value)} value · ${pct(data.value ? data.debt / data.value : 0, 0)} LTV`} />
        ) : (
          <Stat label="Expense ratio" value={data.income ? pct(data.expenses / data.income) : '—'} />
        )}
      </div>
      <Card title="Monthly cash flow">
        <div className="chart">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data.months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} width={56} />
              <Tooltip content={<ChartTooltip formatLabel={(m) => monthLabel(m, true)} />} cursor={{ fill: 'var(--hover)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {data.income > 0 && <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />}
              <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Line dataKey="net" name="Net" stroke="var(--text)" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Biggest expenses">
        <BarList items={data.expenseItems} total={data.expenses} />
      </Card>
      <Card title="Transactions">
        <TxList txs={data.txs} pageSize={40} />
      </Card>
      {property.netOnly && (
        <p className="muted small">Only this property's net cash flow counts toward your main cash flow and spending. Change this in Settings.</p>
      )}
    </div>
  );
}
