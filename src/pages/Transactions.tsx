import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useStore } from '../store';
import type { Transaction } from '../types';
import { inRange, isUncategorized } from '../lib/finance';
import { money } from '../lib/format';
import { Card, PageHeader } from '../components/ui';
import { TxList, editable } from '../components/TxList';
import { BulkEdit } from '../components/BulkEdit';
import { AiCategorize } from '../components/AiCategorize';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'uncategorized', label: 'Uncategorized' },
  { id: 'split', label: 'Split' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'duplicates', label: 'Possible duplicates' },
];

const DAY = 86400000;

/**
 * Ids of transactions that share an account and amount with another one within 7 days: the same
 * window Actual uses when it matches bank sync imports to existing transactions. Starting balances aside.
 */
function possibleDuplicates(txs: Transaction[]) {
  const byKey = new Map<string, Transaction[]>();
  for (const t of txs) {
    if (t.startingBalance || !t.amount) continue;
    const k = t.accountId + '|' + Math.round(t.amount * 100);
    byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  const out = new Set<string>();
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      if (Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date) <= 7 * DAY) {
        out.add(sorted[i].id);
        out.add(sorted[i - 1].id);
      }
    }
  }
  return out;
}

export function TransactionsPage() {
  const { model, period } = useStore();
  const [params, setParams] = useSearchParams();
  const [aiOpen, setAiOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const lastPick = useRef<string | null>(null);
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

  const dupes = useMemo(() => (filter === 'duplicates' ? possibleDuplicates(model.data.transactions) : null), [model, filter]);

  const txs = useMemo(() => {
    const list = model.data.transactions.filter((t) => {
      if (!inRange(t, period.start, period.end)) return false;
      if (filter === 'uncategorized' && !isUncategorized(model, t)) return false;
      if (filter === 'split' && !t.splits) return false;
      if (filter === 'transfers' && !t.transferAccountId) return false;
      if (dupes && !dupes.has(t.id)) return false;
      if (account && t.accountId !== account) return false;
      if (scopeMatch && !(t.splits ? t.splits.some((s) => scopeMatch(s.categoryId)) : scopeMatch(t.categoryId))) return false;
      if (q) {
        const cats = t.splits ? t.splits.map((s) => `${model.categoryName(s.categoryId)} ${s.notes}`).join(' ') : model.categoryName(t.categoryId);
        const hay = `${t.payee} ${t.notes} ${cats} ${model.accountLabel(t.accountId)} ${Math.abs(t.amount).toFixed(2)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Keep look-alikes next to each other: by account, then amount, then date.
    if (dupes) list.sort((a, b) => a.accountId.localeCompare(b.accountId) || a.amount - b.amount || b.date.localeCompare(a.date));
    return list;
  }, [model, period, filter, q, account, scopeMatch, dupes]);

  // Only rows still in the list count as selected, so changing a filter never edits rows you can't see.
  const selectable = useMemo(() => txs.filter((t) => editable(model, t)), [txs, model]);
  const picked = useMemo(() => selectable.filter((t) => selected.has(t.id)).map((t) => t.id), [selectable, selected]);
  const allPicked = selectable.length > 0 && picked.length === selectable.length;

  const toggle = (id: string, range: boolean) => {
    setNotice('');
    // Shift-click sets every row between the last one clicked and this one to this row's new state.
    const ids = selectable.map((t) => t.id);
    const a = range && lastPick.current ? ids.indexOf(lastPick.current) : -1;
    const b = ids.indexOf(id);
    const span = a >= 0 && b >= 0 ? ids.slice(Math.min(a, b), Math.max(a, b) + 1) : [id];
    const on = !selected.has(id);
    const next = new Set(selected);
    for (const x of span) on ? next.add(x) : next.delete(x);
    setSelected(next);
    lastPick.current = id;
  };
  const toggleAll = () => {
    setNotice('');
    setSelected(allPicked ? new Set() : new Set(selectable.map((t) => t.id)));
    lastPick.current = null;
  };
  const clearSelection = () => {
    setSelected(new Set());
    lastPick.current = null;
  };

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
          {selectable.length > 0 && (
            <input
              type="checkbox"
              className="tx-check"
              checked={allPicked}
              ref={(el) => {
                if (el) el.indeterminate = picked.length > 0 && !allPicked;
              }}
              onChange={toggleAll}
              aria-label={allPicked ? 'Clear selection' : `Select all ${selectable.length} transactions`}
              title={allPicked ? 'Clear selection' : `Select all ${selectable.length}` + (selectable.length < txs.length ? ` (${txs.length - selectable.length} splits and transfers can't be bulk edited)` : '')}
            />
          )}
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
        {picked.length > 0 && (
          <BulkEdit
            txIds={picked}
            onClear={clearSelection}
            onDone={(m) => {
              clearSelection();
              setNotice(m);
            }}
          />
        )}
        {picked.length > 0 && allPicked && selectable.length < txs.length && (
          <p className="muted bulk-note">{txs.length - selectable.length} splits and transfers in this list aren't selected; edit those one at a time.</p>
        )}
        {notice && picked.length === 0 && (
          <p className="bulk-note">
            {notice}{' '}
            <button className="link-btn" onClick={() => setNotice('')}>Dismiss</button>
          </p>
        )}
        {aiOpen && <AiCategorize txIds={totals.uncategorizedIds} onClose={() => setAiOpen(false)} />}
        {/* A fresh list per filter, so switching filters draws the same rows as opening the link directly. */}
        <TxList key={`${params.toString()}|${period.start}|${period.end}`} txs={txs} selection={{ selected, onToggle: toggle }} />
      </Card>
    </div>
  );
}
