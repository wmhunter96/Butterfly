import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import { merchants, monthly, summarize, type Item } from '../lib/finance';
import { flowLines, INCOME_COLOR } from '../lib/model';
import { money, moneyCompact, monthLabel, pct } from '../lib/format';
import { BarList, Card, ChartTooltip, PageHeader, Segmented, Stat } from '../components/ui';
import { CashFlowSankey, type SankeyMode } from '../components/Sankey';

export const EXPENSE_COLOR = '#eb6834';

export function txLinkFor(it: Item) {
  if (it.kind === 'property') return '/transactions?property=' + encodeURIComponent(it.propertyId!);
  if (it.kind === 'merchant') return '/transactions?q=' + encodeURIComponent(it.key);
  if (it.kind === 'group') return it.key === 'uncategorized' ? '/transactions?filter=uncategorized' : '/transactions?group=' + encodeURIComponent(it.key);
  if (it.key === 'uncategorized' || it.key === 'uncategorized-income') return '/transactions?filter=uncategorized';
  return '/transactions?category=' + encodeURIComponent(it.key);
}

export function CashFlowPage() {
  const { model, period } = useStore();
  const nav = useNavigate();
  const [mode, setMode] = useState<SankeyMode>('groups');
  const [view, setView] = useState<'sankey' | 'pl'>(() => (window.innerWidth < 640 ? 'pl' : 'sankey'));
  const [expView, setExpView] = useState<'group' | 'category' | 'merchant'>('group');

  const lines = useMemo(() => flowLines(model, period.start, period.end), [model, period]);
  const s = useMemo(() => summarize(model, lines), [model, lines]);
  const months = useMemo(() => monthly(model, period.start, period.end), [model, period]);
  const merch = useMemo(() => merchants(model, lines), [model, lines]);
  const savingsRate = s.totalIncome > 0 ? s.net / s.totalIncome : 0;

  const all = [...s.income, ...s.expenses, ...s.categories];
  const openKey = (key: string) => {
    const it = all.find((i) => i.key === key);
    if (it) nav(txLinkFor(it));
  };

  return (
    <div className="page">
      <PageHeader title="Cash flow" />
      <div className="stats">
        <Stat label="Income" dot={INCOME_COLOR} value={money(s.totalIncome)} />
        <Stat label="Expenses" dot={EXPENSE_COLOR} value={money(s.totalExpenses)} />
        <Stat label="Net cash flow" value={money(s.net)} tone={s.net >= 0 ? 'pos' : 'neg'} />
        <Stat label="Savings rate" value={pct(savingsRate)} sub={`${months.length} month${months.length === 1 ? '' : 's'}`} />
      </div>

      <Card
        title="Where the money went"
        actions={
          <>
            {view === 'sankey' && (
              <Segmented value={mode} onChange={setMode} options={[{ id: 'groups', label: 'Groups' }, { id: 'categories', label: 'Categories' }, { id: 'both', label: 'Both' }]} />
            )}
            <Segmented value={view} onChange={setView} options={[{ id: 'sankey', label: 'Sankey' }, { id: 'pl', label: 'Profit & loss' }]} />
          </>
        }
      >
        {view === 'sankey' ? (
          <CashFlowSankey income={s.income} expenses={s.expenses} totalIncome={s.totalIncome} mode={mode} onSelect={openKey} />
        ) : (
          <ProfitLoss income={s.income} expenses={s.expenses} totalIncome={s.totalIncome} totalExpenses={s.totalExpenses} />
        )}
      </Card>

      <Card title="Monthly cash flow">
        <div className="chart">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tickLine={false} axisLine={false} fontSize={12} />
              <YAxis tickFormatter={moneyCompact} tickLine={false} axisLine={false} fontSize={12} width={56} />
              <Tooltip content={<ChartTooltip formatLabel={(m) => monthLabel(m, true)} />} cursor={{ fill: 'var(--hover)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Line dataKey="net" name="Net" stroke="var(--text)" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Income">
          <BarList items={s.income} total={s.totalIncome} onSelect={(it) => nav(txLinkFor(it))} />
        </Card>
        <Card
          title="Expenses"
          actions={<Segmented value={expView} onChange={setExpView} options={[{ id: 'group', label: 'Group' }, { id: 'category', label: 'Category' }, { id: 'merchant', label: 'Merchant' }]} />}
        >
          <BarList
            items={expView === 'group' ? s.expenses : expView === 'category' ? s.categories : merch}
            total={s.totalExpenses}
            onSelect={(it) => nav(txLinkFor(it))}
            max={expView === 'group' ? undefined : 15}
          />
        </Card>
      </div>
    </div>
  );
}

export function ProfitLoss({ income, expenses, totalIncome, totalExpenses }: { income: Item[]; expenses: Item[]; totalIncome: number; totalExpenses: number }) {
  const [open, setOpen] = useState<Set<string>>(new Set(['__income']));
  const toggle = (k: string) => {
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOpen(n);
  };
  const Row = ({ it, depth, sign }: { it: Item; depth: number; sign: 1 | -1 }) => (
    <tr className={depth ? 'sub' : ''} onClick={() => it.children?.length && toggle(it.key)}>
      <td>
        <span className="pl-name" style={{ paddingLeft: depth * 18 }}>
          {it.children?.length ? open.has(it.key) ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="chev-space" />}
          <span className="dot" style={{ background: it.color }} />
          {it.label}
        </span>
      </td>
      <td className="num muted">{pct(totalIncome ? it.amount / totalIncome : 0)}</td>
      <td className="num">{money(sign * it.amount)}</td>
    </tr>
  );
  return (
    <div className="table-scroll">
      <table className="pl">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">% of income</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="pl-head" onClick={() => toggle('__income')}>
            <td>
              <span className="pl-name">
                {open.has('__income') ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Income
              </span>
            </td>
            <td />
            <td className="num">{money(totalIncome)}</td>
          </tr>
          {open.has('__income') && income.map((it) => <Row key={it.key} it={it} depth={1} sign={1} />)}
          <tr className="pl-head">
            <td>
              <span className="pl-name">Expenses</span>
            </td>
            <td className="num muted">{pct(totalIncome ? totalExpenses / totalIncome : 0)}</td>
            <td className="num">{money(-totalExpenses)}</td>
          </tr>
          {expenses.map((g) => (
            <Fragment key={g.key}>
              <Row it={g} depth={0} sign={-1} />
              {open.has(g.key) && g.children?.map((c) => <Row key={c.key} it={c} depth={1} sign={-1} />)}
            </Fragment>
          ))}
          <tr className="pl-total">
            <td>Net cash flow</td>
            <td className="num muted">{pct(totalIncome ? (totalIncome - totalExpenses) / totalIncome : 0)}</td>
            <td className={'num ' + (totalIncome - totalExpenses >= 0 ? 'pos' : 'neg')}>{money(totalIncome - totalExpenses)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
