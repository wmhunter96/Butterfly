import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import { netWorthAt } from '../lib/finance';
import { ACCOUNT_TYPES, isLiabilityType, PALETTE, type Model } from '../lib/model';
import { endOfMonth, iso, money, moneyCompact, monthLabel, monthsBetween, parseDate, signed } from '../lib/format';
import { Card, ChartTooltip, PageHeader, Segmented, Stat } from '../components/ui';
import type { AccountType } from '../types';

export const TYPE_COLORS: Record<AccountType, string> = {
  cash: PALETTE[0],
  investment: PALETTE[2],
  retirement: PALETTE[6],
  property: PALETTE[3],
  vehicle: PALETTE[4],
  other: '#a8a29e',
  credit: PALETTE[7],
  mortgage: PALETTE[1],
  loan: PALETTE[5],
};

export function groupAccountsByType(model: Model, date: string, startDate: string) {
  return ACCOUNT_TYPES.map((t) => {
    const accounts = model.data.accounts
      .filter((a) => model.accountType(a.id) === t.id && !(a.closed && Math.abs(model.balanceAt(a.id, date)) < 0.005))
      .map((a) => ({ account: a, balance: model.balanceAt(a.id, date), start: model.balanceAt(a.id, startDate) }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
    return { ...t, color: TYPE_COLORS[t.id], accounts, total: accounts.reduce((s, a) => s + a.balance, 0), startTotal: accounts.reduce((s, a) => s + a.start, 0) };
  }).filter((g) => g.accounts.length);
}

export function NetWorthPage() {
  const { model, period } = useStore();
  const [view, setView] = useState<'net' | 'split'>('net');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const before = (() => {
    const d = parseDate(period.start);
    d.setDate(d.getDate() - 1);
    return iso(d);
  })();

  const series = useMemo(() => {
    const start = period.start < model.earliest ? model.earliest : period.start;
    const pts = [{ month: 'start', date: before }, ...monthsBetween(start, period.end).map((m) => ({ month: m, date: endOfMonth(m) > period.end ? period.end : endOfMonth(m) }))];
    return pts.map((p) => ({ ...p, ...netWorthAt(model, p.date) })).slice(period.start <= model.earliest ? 1 : 0);
  }, [model, period, before]);

  const now = netWorthAt(model, period.end);
  const then = netWorthAt(model, before);
  const types = useMemo(() => groupAccountsByType(model, period.end, before), [model, period, before]);
  const assets = types.filter((t) => !t.liability);
  const liabilities = types.filter((t) => t.liability);
  const fmtLabel = (m: string) => (m === 'start' ? 'Start' : monthLabel(m, true));

  const TypeList = ({ list, total, title }: { list: typeof types; total: number; title: string }) => (
    <Card title={title} actions={<b className="num">{money(Math.abs(total))}</b>}>
      <div className="type-bar">
        {list.map((t) => (
          <div key={t.id} style={{ flex: Math.abs(t.total), background: t.color }} title={t.label} />
        ))}
      </div>
      {list.map((t) => (
        <div key={t.id} className="acct-group">
          <div className="acct-group-head" onClick={() => { const n = new Set(open); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setOpen(n); }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {open.has(t.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="dot" style={{ background: t.color }} /> {t.label} <span className="muted small">{t.accounts.length}</span>
            </span>
            <span className="num">
              {money(Math.abs(t.total))} <Delta value={t.total - t.startTotal} liability={t.liability} />
            </span>
          </div>
          {open.has(t.id) &&
            t.accounts.map((a) => (
              <Link key={a.account.id} className="acct-row" to={'/accounts/' + encodeURIComponent(a.account.id)}>
                <span className="name">{model.accountLabel(a.account.id)}</span>
                <span className="num"><Delta value={a.balance - a.start} liability={t.liability} /></span>
                <span className="num">{money(Math.abs(a.balance))}</span>
              </Link>
            ))}
        </div>
      ))}
    </Card>
  );

  return (
    <div className="page">
      <PageHeader title="Net worth" />
      <div className="stats">
        <Stat label="Net worth" value={money(now.net)} sub={'As of ' + parseDate(period.end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} />
        <Stat label="Change this period" dot={now.net - then.net >= 0 ? '#1baf7a' : '#e34948'} value={signed(now.net - then.net)} tone={now.net - then.net >= 0 ? 'pos' : 'neg'} />
        <Stat label="Assets" value={money(now.assets)} />
        <Stat label="Liabilities" value={money(now.liabilities)} />
      </div>
      <Card title="Net worth over time" actions={<Segmented value={view} onChange={setView} options={[{ id: 'net', label: 'Net worth' }, { id: 'split', label: 'Assets & liabilities' }]} />}>
        <div className="chart">
          <ResponsiveContainer width="100%" height={300}>
            {view === 'net' ? (
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#eb6834" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#eb6834" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="month" tickFormatter={(m) => (m === 'start' ? '' : monthLabel(m))} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} width={64} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip formatLabel={fmtLabel} />} />
                <Area dataKey="net" name="Net worth" stroke="#eb6834" strokeWidth={2} fill="url(#nw)" dot={{ r: 3, fill: '#eb6834' }} type="monotone" />
              </AreaChart>
            ) : (
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="month" tickFormatter={(m) => (m === 'start' ? '' : monthLabel(m))} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} width={64} />
                <Tooltip content={<ChartTooltip formatLabel={fmtLabel} />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="assets" name="Assets" stroke="#2a78d6" strokeWidth={2} dot={false} type="monotone" />
                <Line dataKey="liabilities" name="Liabilities" stroke="#e34948" strokeWidth={2} dot={false} type="monotone" />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid-2">
        <TypeList list={assets} total={now.assets} title="Assets" />
        <TypeList list={liabilities} total={-now.liabilities} title="Liabilities" />
      </div>
    </div>
  );
}

export const liabilityAccounts = (model: Model) => model.data.accounts.filter((a) => isLiabilityType(model.accountType(a.id)));

/** Change in value; for debts shown as change in amount owed (down is good). */
export function Delta({ value, liability }: { value: number; liability: boolean }) {
  const shown = liability ? -value : value;
  if (Math.abs(shown) < 0.005) return <span className="small muted">—</span>;
  const good = liability ? shown < 0 : shown > 0;
  return <span className={'small ' + (good ? 'pos' : 'neg')}>{signed(shown)}</span>;
}
