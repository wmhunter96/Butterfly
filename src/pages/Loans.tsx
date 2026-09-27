import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../store';
import { balanceSeries } from '../lib/finance';
import type { Model } from '../lib/model';
import { iso, money, moneyCompact, monthLabel, parseDate } from '../lib/format';
import { Card, ChartTooltip, PageHeader, Stat } from '../components/ui';
import { TYPE_COLORS } from './NetWorth';

export function loanStats(model: Model, id: string, start: string, end: string) {
  const balance = -model.balanceAt(id, end);
  const startBal = -model.balanceAt(id, start);
  let paid = 0;
  let interest = 0;
  for (const t of model.data.transactions) {
    if (t.accountId !== id || t.startingBalance || t.date < start || t.date > end) continue;
    if (t.amount > 0) paid += t.amount;
    else interest -= t.amount;
  }
  // Pace from the last 6 months of payments.
  const d = parseDate(end);
  const sixAgo = iso(new Date(d.getFullYear(), d.getMonth() - 6, d.getDate()));
  let recentPaid = 0;
  for (const t of model.data.transactions) if (t.accountId === id && !t.startingBalance && t.amount > 0 && t.date > sixAgo && t.date <= end) recentPaid += t.amount;
  const payment = recentPaid / 6;
  const principalPace = (-model.balanceAt(id, sixAgo) - balance) / 6;
  // Use the APR from Settings, or infer one from recent interest charges.
  let recentInterest = 0;
  for (const t of model.data.transactions) if (t.accountId === id && !t.startingBalance && t.amount < 0 && t.date > sixAgo && t.date <= end) recentInterest -= t.amount;
  const avgBal = (balance - model.balanceAt(id, sixAgo)) / 2;
  const inferred = recentInterest > 0 && avgBal > 0 ? Math.round((recentInterest / avgBal / 6) * 12 * 10000) / 100 : undefined;
  const apr = model.settings.loanRates[id] ?? inferred;
  const aprInferred = model.settings.loanRates[id] == null && inferred != null;
  let monthsLeft: number | null = null;
  if (balance > 0 && payment > 0 && apr) {
    const r = apr / 100 / 12;
    const x = 1 - (r * balance) / payment;
    monthsLeft = x > 0 ? Math.ceil(-Math.log(x) / Math.log(1 + r)) : null;
  } else if (balance > 0 && principalPace > 0) monthsLeft = Math.ceil(balance / principalPace);
  const payoff = monthsLeft != null ? new Date(d.getFullYear(), d.getMonth() + monthsLeft, 1) : null;
  return { balance, startBal, paid, interest, principal: startBal - balance, payment, apr, aprInferred, payoff, monthsLeft };
}

export function LoansPage() {
  const { model, period } = useStore();
  const loans = useMemo(
    () => model.data.accounts.filter((a) => !a.closed && ['mortgage', 'loan'].includes(model.accountType(a.id))).map((a) => ({ a, s: loanStats(model, a.id, period.start, period.end) })),
    [model, period],
  );
  const total = loans.reduce((s, l) => s + l.s.balance, 0);
  const principal = loans.reduce((s, l) => s + l.s.principal, 0);
  const interest = loans.reduce((s, l) => s + l.s.interest, 0);
  const payment = loans.reduce((s, l) => s + l.s.payment, 0);

  return (
    <div className="page">
      <PageHeader title="Loans" />
      <div className="stats">
        <Stat label="Total owed" value={money(total)} />
        <Stat label="Principal paid this period" value={money(principal)} tone="pos" />
        <Stat label="Interest this period" value={money(interest)} />
        <Stat label="Monthly payments" value={money(payment)} sub="Average of last 6 months" />
      </div>
      {!loans.length && <Card><p className="muted empty">No loan or mortgage accounts yet. Set account types in <Link to="/settings">Settings</Link>.</p></Card>}
      <div className="grid-2">
        {loans.map(({ a, s }) => (
          <LoanCard key={a.id} id={a.id} name={a.name} s={s} />
        ))}
      </div>
    </div>
  );
}

function LoanCard({ id, name, s }: { id: string; name: string; s: ReturnType<typeof loanStats> }) {
  const { model, period } = useStore();
  const color = TYPE_COLORS[model.accountType(id)];
  const series = useMemo(() => balanceSeries(model, [id], period.start, period.end).map((p) => ({ ...p, value: -p.value })), [model, id, period]);
  const paidPct = s.startBal > 0 ? s.principal / s.startBal : 0;
  return (
    <Card title={<Link to={'/accounts/' + encodeURIComponent(id)}>{name}</Link>} actions={<b className="num">{money(s.balance)}</b>}>
      <div className="loan-facts">
        <div><span className="muted small">Principal paid</span><b className="pos">{money(s.principal)}</b></div>
        <div><span className="muted small">Interest paid</span><b>{money(s.interest)}</b></div>
        <div><span className="muted small">Monthly payment</span><b>{money(s.payment)}</b></div>
        <div>
          <span className="muted small">Est. payoff{s.apr ? ` at ${s.aprInferred ? '~' : ''}${s.apr}%` : ''}</span>
          <b>{s.payoff ? s.payoff.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</b>
        </div>
      </div>
      <div className="bar-track" style={{ margin: '12px 0 4px' }} title={`${(paidPct * 100).toFixed(1)}% of starting balance paid this period`}>
        <div className="bar-fill" style={{ width: `${Math.min(100, paidPct * 100)}%`, background: color }} />
      </div>
      <div className="chart">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={series} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tickLine={false} axisLine={false} fontSize={11} />
            <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={11} width={56} domain={['auto', 'auto']} />
            <Tooltip content={<ChartTooltip formatLabel={(m) => monthLabel(m, true)} />} />
            <Area dataKey="value" name="Balance owed" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.1} type="monotone" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
