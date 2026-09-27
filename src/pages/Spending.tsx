import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../store';
import { merchants, monthlyBy, summarize, type Item } from '../lib/finance';
import { flowLines, lineKey, NEUTRAL, PALETTE } from '../lib/model';
import { money, money0, moneyCompact, monthLabel, monthsBetween, pct } from '../lib/format';
import { BarList, Card, ChartTooltip, PageHeader, Segmented, Stat } from '../components/ui';
import { txLinkFor } from './CashFlow';

type View = 'groups' | 'categories' | 'merchants';

export function SpendingPage() {
  const { model, period } = useStore();
  const nav = useNavigate();
  const [view, setView] = useState<View>('groups');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const lines = useMemo(() => flowLines(model, period.start, period.end), [model, period]);
  const s = useMemo(() => summarize(model, lines), [model, lines]);
  const merch = useMemo(() => (view === 'merchants' ? merchants(model, lines) : []), [model, lines, view]);
  const items: Item[] = (view === 'groups' ? s.expenses : view === 'categories' ? s.categories : merch).filter((i) => i.amount > 0);
  const total = s.totalExpenses;
  const months = monthsBetween(period.start, period.end).length;
  const txCount = new Set(lines.filter((l) => lineKey(model, l).kind !== 'income' && l.amount < 0).map((l) => l.tx.id)).size;
  const largest = s.expenses[0];

  // Merchants get a stable categorical slot by rank within the view (they have no entity color).
  const colored = view === 'merchants' ? items.map((it, i) => ({ ...it, color: PALETTE[i] ?? NEUTRAL })) : items;
  const donut = colored.slice(0, 10);
  const rest = colored.slice(10).reduce((a, b) => a + b.amount, 0);
  const donutData = rest > 0 ? [...donut, { key: 'other', label: 'Other', amount: rest, color: NEUTRAL } as Item] : donut;

  // Trend: selected items, or the top groups stacked.
  const trendKeys = picked.size ? colored.filter((i) => picked.has(i.key)) : s.expenses.filter((i) => i.amount > 0).slice(0, 8);
  const trendView: View = picked.size ? view : 'groups';
  const trend = useMemo(() => {
    const keys = new Set(trendKeys.map((k) => k.key));
    return monthlyBy(model, period.start, period.end, (l) => {
      const k = lineKey(model, l);
      if (k.kind === 'income' || (k.kind === 'property' && l.amount > 0)) return null;
      const key = trendView === 'merchants' ? l.tx.payee : trendView === 'categories' ? (k.kind === 'property' ? k.key : l.categoryId ?? 'uncategorized') : k.kind === 'expense' ? k.groupId : k.key;
      return keys.has(key) ? key : picked.size ? null : '__other';
    });
  }, [model, period, trendKeys.map((k) => k.key).join('|'), trendView, picked.size]);

  const toggle = (it: Item) => {
    const n = new Set(picked);
    if (n.has(it.key)) n.delete(it.key);
    else n.add(it.key);
    setPicked(n);
  };

  return (
    <div className="page">
      <PageHeader title="Spending" />
      <div className="stats">
        <Stat label="Total spending" dot="#eb6834" value={money(total)} />
        <Stat label="Average per month" value={money(months ? total / months : 0)} />
        <Stat label="Largest group" value={largest?.label ?? '—'} sub={largest ? `${pct(largest.amount / (total || 1))} of spending` : undefined} />
        <Stat label="Transactions" value={txCount.toLocaleString()} />
      </div>

      <Card
        title="Spending breakdown"
        actions={
          <Segmented
            value={view}
            onChange={(v) => {
              setView(v);
              setPicked(new Set());
            }}
            options={[{ id: 'groups', label: 'Groups' }, { id: 'categories', label: 'Categories' }, { id: 'merchants', label: 'Merchants' }]}
          />
        }
      >
        <div className="breakdown">
          <div className="donut">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={donutData} dataKey="amount" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={1} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false}>
                  {donutData.map((d) => (
                    <Cell key={d.key} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => money(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <span className="muted small">Total</span>
              <b>{money0(total)}</b>
            </div>
          </div>
          <div className="breakdown-list">
            <p className="muted small" style={{ margin: '0 0 6px' }}>Click rows to chart them below.</p>
            <BarList items={colored} total={total} selected={picked} onSelect={toggle} max={view === 'groups' ? undefined : 20} />
          </div>
        </div>
      </Card>

      <Card
        title="Spending trend"
        actions={
          picked.size ? (
            <>
              <button className="btn" onClick={() => setPicked(new Set())}>Clear selection</button>
              {picked.size === 1 && (
                <button className="btn" onClick={() => nav(txLinkFor(colored.find((i) => picked.has(i.key))!))}>
                  View transactions
                </button>
              )}
            </>
          ) : undefined
        }
      >
        <div className="chart">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} width={56} />
              <Tooltip content={<ChartTooltip formatLabel={(m) => monthLabel(m, true)} />} cursor={{ fill: 'var(--hover)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {trendKeys.map((k, i) => (
                <Bar key={k.key} dataKey={k.key} name={k.label} stackId="s" fill={k.color} stroke="var(--surface)" strokeWidth={1} radius={i === trendKeys.length - 1 && picked.size ? [4, 4, 0, 0] : 0} maxBarSize={36} />
              ))}
              {!picked.size && <Bar dataKey="__other" name="Other" stackId="s" fill={NEUTRAL} stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={36} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
