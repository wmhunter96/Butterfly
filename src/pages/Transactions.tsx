import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useStore } from '../store';
import { inRange, isUncategorized } from '../lib/finance';
import { money } from '../lib/format';
import { Card, PageHeader } from '../components/ui';
import { TxList } from '../components/TxList';
import { AiCategorize } from '../components/AiCategorize';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'uncategorized', label: 'Uncategorized' },
  { id: 'split', label: 'Split' },
  { id: 'transfers', label: 'Transfers' },
];

export function TransactionsPage() {
  const { model, period } = useStore();
  const [params, setParams] = useSearchParams();
  const [aiOpen, setAiOpen] = useState(false);
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

  // Category, group or property scope. For a split, only the matching lines count toward totals.
  const scopeMatch = useMemo(() => {
    if (category) return (c: string | null) => c === category;
    if (group) return (c: string | null) => !!c && model.catById.get(c)?.groupId === group;
    if (property) return (c: string | null) => !!c && property.categoryIds.includes(c);
    return null;
  }, [model, category, group, property]);

  const txs = useMemo(() => {
    return model.data.transactions.filter((t) => {
      if (!inRange(t, period.start, period.end)) return false;
      if (filter === 'uncategorized' && !isUncategorized(model, t)) return false;
      if (filter === 'split' && !t.splits) return false;
      if (filter === 'transfers' && !t.transferAccountId) return false;
      if (account && t.accountId !== account) return false;
      if (scopeMatch && !(t.splits ? t.splits.some((s) => scopeMatch(s.categoryId)) : scopeMatch(t.categoryId))) return false;
      if (q) {
        const cats = t.splits ? t.splits.map((s) => `${model.categoryName(s.categoryId)} ${s.notes}`).join(' ') : model.categoryName(t.categoryId);
        const hay = `${t.payee} ${t.notes} ${cats} ${model.accountById.get(t.accountId)?.name ?? ''} ${Math.abs(t.amount).toFixed(2)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [model, period, filter, q, account, scopeMatch]);

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    const add = (amount: number) => {
      if (amount > 0) inflow += amount;
      else outflow -= amount;
    };
    for (const t of txs) {
      if (t.transferAccountId && !t.categoryId) continue;
      if (scopeMatch && t.splits) for (const s of t.splits) if (scopeMatch(s.categoryId)) add(s.amount);
      if (!(scopeMatch && t.splits)) add(t.amount);
    }
    return { inflow, outflow, uncategorizedIds: txs.filter((t) => isUncategorized(model, t)).map((t) => t.id) };
  }, [txs, model, scopeMatch]);

  // "Uncategorized" and a category scope can never both match, so picking one clears the other.
  const setScope = (k: 'category' | 'group' | 'property' | '', v = '') => {
    const p = new URLSearchParams(params);
    p.delete('category');
    p.delete('group');
    p.delete('property');
    if (k && v) {
      p.set(k, v);
      if (p.get('filter') === 'uncategorized') p.delete('filter');
    }
    setParams(p, { replace: true });
  };
  const setFilter = (f: string) => {
    const p = new URLSearchParams(params);
    if (f) p.set('filter', f);
    else p.delete('filter');
    if (f === 'uncategorized') ['category', 'group', 'property'].forEach((k) => p.delete(k));
    setParams(p, { replace: true });
  };

  const activeScope = category ? model.categoryName(category) : group ? model.groupById.get(group)?.name : property?.name;

  return (
    <div className="page">
      <PageHeader title="Transactions" />
      <Card>
        <div className="tx-toolbar">
          <input type="search" placeholder="Search merchant, notes, category or amount" value={get('q')} onChange={(e) => set('q', e.target.value)} />
          <select value={account} onChange={(e) => set('account', e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {model.data.accounts
              .filter((a) => !a.closed)
              .map((a) => ({ id: a.id, label: model.accountLabel(a.id) }))
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
          </select>
          <select
            value={category ? 'c:' + category : group ? 'g:' + group : property ? 'p:' + property.id : ''}
            aria-label="Category"
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('c:')) setScope('category', v.slice(2));
              else if (v.startsWith('g:')) setScope('group', v.slice(2));
              else if (v.startsWith('p:')) setScope('property', v.slice(2));
              else setScope('');
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
            {model.settings.properties.length > 0 && (
              <optgroup label="Properties">
                {model.settings.properties.map((p) => (
                  <option key={p.id} value={'p:' + p.id}>{p.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="chips">
          {FILTERS.map((f) => (
            <button key={f.id} className={'chip' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
          {activeScope && (
            <button className="chip on" onClick={() => setScope('')}>
              {activeScope} <X size={11} />
            </button>
          )}
        </div>
        <div className="tx-summary">
          {txs.length} transactions · <span className="pos">{money(totals.inflow)} in</span> · {money(totals.outflow)} out
          {totals.uncategorizedIds.length > 0 && (
            <>
              {' · '}
              <span style={{ color: 'var(--accent)' }}>{totals.uncategorizedIds.length} uncategorized</span>
              {!aiOpen && (
                <button className="link-btn ai-link" onClick={() => setAiOpen(true)}>
                  <Sparkles size={12} /> Categorize with AI
                </button>
              )}
            </>
          )}
        </div>
        {aiOpen && <AiCategorize txIds={totals.uncategorizedIds} onClose={() => setAiOpen(false)} />}
        {/* A fresh list per filter, so switching filters draws the same rows as opening the link directly. */}
        <TxList key={`${params.toString()}|${period.start}|${period.end}`} txs={txs} />
      </Card>
    </div>
  );
}
