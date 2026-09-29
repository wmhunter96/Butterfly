import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { api, useStore } from '../store';
import { CategoryOptions, TRANSFER, confirmDelete } from './TxList';

const UNCATEGORIZED = '__uncategorized';

type BulkResult = { updated: number; skipped: number; unmatched?: string[] };

/** The bar shown while transactions are selected: pick one category (or a transfer account) and apply it to all of them. */
export function BulkEdit({ txIds, onClear, onDone }: { txIds: string[]; onClear: () => void; onDone: (message: string) => void }) {
  const { model, categorized, refresh, deleteTransactions } = useStore();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const n = (k: number) => `${k} transaction${k === 1 ? '' : 's'}`;

  const apply = async () => {
    setBusy(true);
    try {
      const bulk = (body: object) => api<BulkResult>('/api/transactions/bulk', { method: 'POST', body: JSON.stringify(body) });
      if (value.startsWith(TRANSFER)) {
        const accountId = value.slice(TRANSFER.length);
        const name = model.accountLabel(accountId);
        const r = await bulk({ txIds, transferAccountId: accountId });
        let done = r.updated;
        let left = r.unmatched?.length ?? 0;
        // No matching transaction on that account: Actual would add one there, which is only right if the money really moved through it.
        if (left && confirm(`${n(left)} ha${left === 1 ? 's' : 've'} no matching transaction on ${name} within 5 days. Mark ${left === 1 ? 'it' : 'them'} as transfers anyway? Actual will add the other side to ${name}. Cancel leaves ${left === 1 ? 'it' : 'them'} as ${left === 1 ? 'it is' : 'they are'}.`)) {
          const r2 = await bulk({ txIds: r.unmatched, transferAccountId: accountId, create: true });
          done += r2.updated;
          left = 0;
        }
        await refresh();
        const notes = [r.skipped && `${r.skipped} skipped (splits, existing transfers, or already in ${name})`, left && `${left} left unchanged`].filter(Boolean);
        onDone(`Marked ${n(done)} as transfers with ${name}.${notes.length ? ' ' + notes.join(', ') + '.' : ''}`);
      } else {
        const categoryId = value === UNCATEGORIZED ? null : value;
        const r = await bulk({ txIds, categoryId });
        categorized(txIds.map((txId) => ({ txId, categoryId })));
        const label = categoryId ? model.categoryName(categoryId) : 'Uncategorized';
        onDone(`Set ${label} on ${n(r.updated)}.${r.skipped ? ` ${r.skipped} split${r.skipped === 1 ? '' : 's'} skipped.` : ''}`);
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const txs = model.data.transactions.filter((t) => txIds.includes(t.id));
    if (!confirmDelete(model, txs)) return;
    setBusy(true);
    try {
      await deleteTransactions(txIds);
      onDone(`Deleted ${n(txs.length)}.`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-bar">
      <b>{txIds.length} selected</b>
      <select value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} aria-label="Category for selected transactions">
        <option value="" disabled>
          Set category…
        </option>
        <option value={UNCATEGORIZED}>Uncategorized</option>
        <CategoryOptions />
      </select>
      <button className="btn primary" disabled={busy || !value} onClick={apply}>
        {busy ? 'Saving…' : 'Apply'}
      </button>
      <button className="btn" disabled={busy} onClick={remove} title="Delete selected transactions">
        <Trash2 size={14} /> Delete
      </button>
      <button className="icon-btn subtle" onClick={onClear} disabled={busy} aria-label="Clear selection" title="Clear selection">
        <X size={14} />
      </button>
    </div>
  );
}
