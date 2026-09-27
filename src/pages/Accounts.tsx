import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useStore } from '../store';
import { balanceSeries, inRange } from '../lib/finance';
import { ACCOUNT_TYPES, NEUTRAL, PALETTE } from '../lib/model';
import { iso, money, moneyCompact, monthLabel, signed } from '../lib/format';
import { Card, ChartTooltip, PageHeader, Segmented, Stat } from '../components/ui';
import { TxList } from '../components/TxList';
import { groupAccountsByType, TYPE_COLORS } from './NetWorth';

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg className="spark" width={120} height={28} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 116 + 2},${26 - ((v - min) / span) * 24}`).join(' ');
  return (
    <svg className="spark" width={120} height={28} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function AccountsPage() {
  const { model, period } = useStore();
  const today = iso(new Date());
  const yearAgo = iso(new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1));
  const [groupBy, setGroupByState] = useState<'type' | 'bank'>(() => {
    try {
      return localStorage.getItem('butterfly.accountsGroupBy') === 'type' ? 'type' : 'bank';
    } catch {
      return 'bank';
    }
  });
  const setGroupBy = (v: 'type' | 'bank') => {
    setGroupByState(v);
    try {
      localStorage.setItem('butterfly.accountsGroupBy', v);
    } catch {
      /* ignore */
    }
  };
  const types = useMemo(() => groupAccountsByType(model, today, period.start), [model, today, period.start]);
  const groups = useMemo(() => {
    if (groupBy === 'type') return types.map((t) => ({ ...t, showBank: true }));
    // By bank: same rows, bucketed by the bank set in Settings; accounts without one go last.
    const rows = types.flatMap((t) => t.accounts.map((a) => ({ ...a, color: t.color })));
    const banks = new Map<string, typeof rows>();
    for (const r of rows) {
      const bank = model.bankOf(r.account.id) || 'No bank set';
      banks.set(bank, [...(banks.get(bank) ?? []), r]);
    }
    return [...banks.entries()]
      .sort(([a], [b]) => (a === 'No bank set' ? 1 : b === 'No bank set' ? -1 : a.localeCompare(b)))
      .map(([bank, accounts], i) => ({
        id: bank,
        label: bank,
        color: bank === 'No bank set' ? NEUTRAL : PALETTE[i % PALETTE.length],
        accounts,
        total: accounts.reduce((s, a) => s + a.balance, 0),
        showBank: false,
      }));
  }, [groupBy, types, model]);
  const typeColor = (id: string) => TYPE_COLORS[model.accountType(id)];
  return (
    <div className="page">
      <PageHeader title="Accounts">
        <Segmented value={groupBy} onChange={setGroupBy} options={[{ id: 'type', label: 'By type' }, { id: 'bank', label: 'By bank' }]} />
      </PageHeader>
      {groups.map((g) => (
        <Card key={g.id} title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="dot" style={{ background: g.color }} />{g.label}</span>} actions={<b className="num">{money(g.total)}</b>}>
          {g.accounts.map((a) => (
            <Link key={a.account.id} className="acct-row" to={'/accounts/' + encodeURIComponent(a.account.id)}>
              <span className="name">
                {g.showBank ? model.accountLabel(a.account.id) : a.account.name}
                {!g.showBank && <span className="muted small"> · {ACCOUNT_TYPES.find((t) => t.id === model.accountType(a.account.id))?.label}</span>}
                {a.account.offBudget && <span className="muted small"> · off budget</span>}
              </span>
              <Spark values={balanceSeries(model, [a.account.id], yearAgo, today).map((p) => p.value)} color={typeColor(a.account.id)} />
              <span className="num">{money(a.balance)}</span>
            </Link>
          ))}
        </Card>
      ))}
      <p className="muted small">Set or fix each account's bank in <Link to="/settings">Settings</Link>.</p>
    </div>
  );
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const { model, period } = useStore();
  const account = model.accountById.get(id);
  const series = useMemo(() => (account ? balanceSeries(model, [id], period.start, period.end) : []), [model, id, period, account]);
  const txs = useMemo(() => model.data.transactions.filter((t) => t.accountId === id && inRange(t, period.start, period.end)), [model, id, period]);
  if (!account) return <div className="page"><p>Account not found.</p></div>;
  const type = model.accountType(id);
  const color = TYPE_COLORS[type];
  const startBal = series[0] ? model.balanceAt(id, period.start) : account.balance;
  const endBal = model.balanceAt(id, period.end);
  return (
    <div className="page">
      <PageHeader title={model.accountLabel(id)} />
      <div className="stats">
        <Stat label="Balance" value={money(endBal)} />
        <Stat label="Change this period" value={signed(endBal - startBal)} />
        <Stat label="Type" value={ACCOUNT_TYPES.find((t) => t.id === type)?.label} sub={account.offBudget ? 'Off budget' : 'On budget'} />
        <Stat label="Transactions" value={txs.length} />
      </div>
      <Card title="Balance">
        <div className="chart">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} width={64} domain={['auto', 'auto']} />
              <Tooltip content={<ChartTooltip formatLabel={(m) => monthLabel(m, true)} />} />
              <Area dataKey="value" name="Balance" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.1} type="monotone" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Transactions">
        <TxList txs={txs} showAccount={false} />
      </Card>
    </div>
  );
}
