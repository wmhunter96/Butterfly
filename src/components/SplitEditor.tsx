import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Transaction } from '../types';
import { useStore } from '../store';
import { dayLabel, money } from '../lib/format';
import { CategoryOptions } from './TxList';

type Draft = { key: number; id?: string; categoryId: string; amount: string; notes: string };

const toCents = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ''));
  return s.trim() && Number.isFinite(n) ? Math.round(n * 100) : null;
};
const fromCents = (c: number) => (c / 100).toFixed(2);

let nextKey = 1;
const line = (d: Omit<Draft, 'key'>): Draft => ({ key: nextKey++, ...d });

/**
 * Split one transaction across categories. Amounts are typed as positive numbers in the transaction's
 * own direction (a minus sign flips a line, e.g. a refunded item), and saving needs them to add up exactly.
 */
export function SplitEditor({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { model, splitTransaction } = useStore();
  const sign = tx.amount < 0 ? -1 : 1;
  const total = Math.round(Math.abs(tx.amount) * 100);
  const [lines, setLines] = useState<Draft[]>(() =>
    tx.splits
      ? tx.splits.map((s) => line({ id: s.id, categoryId: s.categoryId ?? '', amount: fromCents(Math.round(s.amount * 100) * sign), notes: s.notes }))
      : [line({ categoryId: tx.categoryId ?? '', amount: '', notes: '' }), line({ categoryId: '', amount: '', notes: '' })],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cents = lines.map((l) => toCents(l.amount));
  const assigned = cents.reduce<number>((a, c) => a + (c ?? 0), 0);
  const remaining = total - assigned;
  const invalid = lines.some((l, i) => l.amount.trim() !== '' && cents[i] === null);
  const canSave = lines.length >= 2 && remaining === 0 && !invalid && cents.every((c) => c);

  const update = (key: number, patch: Partial<Draft>) => {
    setError('');
    setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const splitEvenly = () => {
    // Pennies that don't divide evenly go to the first lines.
    const base = Math.floor(total / lines.length);
    const extra = total - base * lines.length;
    setLines(lines.map((l, i) => ({ ...l, amount: fromCents(base + (i < extra ? 1 : 0)) })));
  };
  const empty = lines.filter((l) => !l.amount.trim());
  /**
   * Lines with no amount yet share what's left evenly. When every line has an amount, the difference
   * (tax, shipping, a discount) is spread across them in proportion to their amounts.
   */
  const fillRest = () => {
    setError('');
    const targets = empty.length ? empty : lines;
    const weights = targets.map((l) => (empty.length ? 1 : Math.abs(toCents(l.amount) ?? 0)));
    const sum = weights.reduce((a, w) => a + w, 0) || (weights.fill(1), weights.length);
    // Round down, then hand the leftover pennies to the lines that lost the most to rounding.
    const exact = weights.map((w) => (remaining * w) / sum);
    const share = exact.map((x) => Math.trunc(x));
    let pennies = remaining - share.reduce((a, x) => a + x, 0);
    const order = exact.map((x, i) => i).sort((a, b) => Math.abs(exact[b] - share[b]) - Math.abs(exact[a] - share[a]));
    for (const i of order) {
      if (!pennies) break;
      share[i] += Math.sign(pennies);
      pennies -= Math.sign(pennies);
    }
    const add = new Map(targets.map((l, i) => [l.key, share[i]]));
    setLines(lines.map((l) => (add.has(l.key) ? { ...l, amount: fromCents((toCents(l.amount) ?? 0) + add.get(l.key)!) } : l)));
  };

  const save = async (drafts: Draft[]) => {
    setBusy(true);
    setError('');
    try {
      await splitTransaction(
        tx.id,
        drafts.map((l) => ({ id: l.id, categoryId: l.categoryId || null, amount: ((toCents(l.amount) ?? 0) * sign) / 100, notes: l.notes.trim() })),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const unsplit = () => {
    const cats = [...new Set(lines.map((l) => l.categoryId))];
    const keep = cats.length === 1 && cats[0] ? cats[0] : '';
    const msg = keep
      ? `Remove the split? The whole ${money(Math.abs(tx.amount))} goes to ${model.categoryName(keep)}.`
      : `Remove the split? The whole ${money(Math.abs(tx.amount))} becomes uncategorized so you can pick one category.`;
    if (confirm(msg)) save(keep ? [line({ categoryId: keep, amount: '', notes: '' })] : []);
  };

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <div className="modal split-modal card" role="dialog" aria-modal="true" aria-label={'Split ' + tx.payee} onClick={(e) => e.stopPropagation()}>
        <div className="split-head">
          <div>
            <h2>{tx.splits ? 'Edit split' : 'Split transaction'}</h2>
            <p className="muted small">
              {tx.payee || '(no payee)'} · {dayLabel(tx.date)} · {model.accountLabel(tx.accountId)}
            </p>
          </div>
          <b className={'num ' + (tx.amount > 0 ? 'pos' : '')}>{money(tx.amount)}</b>
        </div>

        <div className="split-lines">
          {lines.map((l, i) => (
            <div className="split-line" key={l.key}>
              <select value={l.categoryId} onChange={(e) => update(l.key, { categoryId: e.target.value })} aria-label={`Category for line ${i + 1}`} className={l.categoryId ? '' : 'uncat'}>
                <option value="">Uncategorized</option>
                <CategoryOptions transfers={false} />
              </select>
              <input
                type="text"
                inputMode="decimal"
                className={'split-amount' + (l.amount.trim() && cents[i] === null ? ' bad' : '')}
                placeholder="0.00"
                value={l.amount}
                onChange={(e) => update(l.key, { amount: e.target.value })}
                aria-label={`Amount for line ${i + 1}`}
              />
              <input type="text" className="split-notes" placeholder="Note (optional)" value={l.notes} onChange={(e) => update(l.key, { notes: e.target.value })} aria-label={`Note for line ${i + 1}`} />
              <button
                className="icon-btn subtle"
                onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                disabled={lines.length <= 2}
                aria-label={`Remove line ${i + 1}`}
                title={lines.length <= 2 ? 'A split needs at least two lines' : 'Remove line'}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="split-tools">
          <button className="link-btn" onClick={() => setLines([...lines, line({ categoryId: '', amount: '', notes: '' })])}>
            <Plus size={12} /> Add line
          </button>
          <button className="link-btn" onClick={splitEvenly}>Split evenly</button>
          <span className={'split-remaining ' + (remaining === 0 ? 'pos' : 'neg')}>
            {remaining === 0 ? 'Fully assigned' : remaining > 0 ? `${money(remaining / 100)} left to assign` : `${money(-remaining / 100)} over`}
            {remaining !== 0 && !invalid && (
              <button
                className="link-btn"
                onClick={fillRest}
                title={empty.length ? 'Split what is left evenly across the empty lines' : 'Spread what is left (tax, shipping) across the lines in proportion to their amounts'}
              >
                {empty.length ? 'Fill in' : remaining > 0 ? 'Spread across lines' : 'Take off across lines'}
              </button>
            )}
          </span>
        </div>

        {error && <p className="neg small" role="alert">{error}</p>}
        <div className="modal-actions">
          {tx.splits && (
            <button className="btn split-remove" onClick={unsplit} disabled={busy}>
              <Trash2 size={14} /> Remove split
            </button>
          )}
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || !canSave} onClick={() => save(lines)}>
            {busy ? 'Saving…' : 'Save split'}
          </button>
        </div>
      </div>
    </div>
  );
}
