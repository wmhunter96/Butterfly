import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { inRange, isUncategorized } from '../lib/finance';
import { money } from '../lib/format';
import { Card, PageHeader } from '../components/ui';
import { TxList } from '../components/TxList';
import type { Transaction } from '../types';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'uncategorized', label: 'Uncategorized' },
  { id: 'split', label: 'Split' },
  { id: 'transfers', label: 'Transfers' },
];

export function TransactionsPage() {
  const { model, period } = useStore();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const filter = get('filter');
  const q = get('q').toLowerCase();
  const account = get('account');
  const category = get('category');
  const group = get('group');
  const propertyId = get('property');
  const property = model.settings.properties.find((p) => p.id === propertyId);

  const txs = useMemo(() => {
    const catMatch = (t: Transaction, pred: (c: string | null) => boolean) => (t.splits ? t.splits.some((s) => pred(s.categoryId)) : pred(t.categoryId));
    return model.data.transactions.filter((t) => {
      if (!inRange(t, period.start, period.end)) return false;
      if (filter === 'uncategorized' && !isUncategorized(model, t)) return false;
      if (filter === 'split' && !t.splits) return false;
      if (filter === 'transfers' && !t.transferAccountId) return false;
      if (account && t.accountId !== account) return false;
      if (category && !catMatch(t, (c) => c === category)) return false;
      if (group && !catMatch(t, (c) => !!c && model.catById.get(c)?.groupId === group)) return false;
      if (property && !catMatch(t, (c) => !!c && property.categoryIds.includes(c))) return false;
      if (q) {
        const hay = `${t.payee} ${t.notes} ${model.categoryName(t.categoryId)} ${Math.abs(t.amount).toFixed(2)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [model, period, filter, q, account, category, group, property]);

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const t of txs) {
      if (t.transferAccountId && !t.categoryId) continue;
      if (t.amount > 0) inflow += t.amount;
      else outflow -= t.amount;
    }
    return { inflow, outflow, uncategorized: txs.filter((t) => isUncategorized(model, t)).length };
  }, [txs, model]);

  const activeScope = category ? model.categoryName(category) : group ? model.groupById.get(group)?.name : property?.name;

  return (
    <div className="page">
      <PageHeader title="Transactions" />
      <Card>
        <div className="tx-toolbar">
          <input type="search" placeholder="Search merchant, notes, category or amount" value={get('q')} onChange={(e) => set('q', e.target.value)} />
          <select value={account} onChange={(e) => set('account', e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {model.data.accounts.filter((a) => !a.closed).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select
            value={category ? 'c:' + category : group ? 'g:' + group : ''}
            aria-label="Category"
            onChange={(e) => {
              const v = e.target.value;
              const p = new URLSearchParams(params);
              p.delete('category');
              p.delete('group');
              p.delete('property');
              if (v.startsWith('c:')) p.set('category', v.slice(2));
              if (v.startsWith('g:')) p.set('group', v.slice(2));
              setParams(p, { replace: true });
            }}
          >
            <option value="">All categories</option>
            {model.data.categoryGroups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                <option value={'g:' + g.id}>All {g.name}</option>
                {model.data.categories.filter((c) => c.groupId === g.id).map((c) => (
                  <option key={c.id} value={'c:' + c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={'chip' + (filter === f.id ? ' on' : '')} onClick={() => set('filter', f.id)}>
              {f.label}
            </button>
          ))}
          {activeScope && (
            <button className="chip on" onClick={() => { const p = new URLSearchParams(params); p.delete('category'); p.delete('group'); p.delete('property'); setParams(p, { replace: true }); }}>
              {activeScope} <X size={11} />
            </button>
          )}
        </div>
        <div className="tx-summary">
          {txs.length} transactions · <span className="pos">{money(totals.inflow)} in</span> · {money(totals.outflow)} out
          {totals.uncategorized > 0 && <> · <span style={{ color: 'var(--accent)' }}>{totals.uncategorized} uncategorized</span></>}
        </div>
        <TxList txs={txs} />
      </Card>
    </div>
  );
}
