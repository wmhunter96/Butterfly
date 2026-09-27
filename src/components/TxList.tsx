import { useMemo, useState } from 'react';
import type { Transaction } from '../types';
import { useStore } from '../store';
import type { Model } from '../lib/model';
import { dayLabel, money } from '../lib/format';
import { Avatar } from './ui';

/** Select value prefix for "this is a transfer to/from that account" (shared with the AI review). */
export const TRANSFER = 'transfer:';

/** Whether a row gets a category picker, and so can be picked for a bulk edit. Splits, starting balances and linked transfers can't. */
export function editable(model: Model, t: Transaction) {
  if (t.splits || t.startingBalance) return false;
  if (!t.categoryId && (t.transferAccountId || model.accountById.get(t.accountId)?.offBudget)) return false;
  return true;
}

/** Visible categories by group, then open accounts (other than excludeAccountId) as transfer targets. */
export function CategoryOptions({ excludeAccountId }: { excludeAccountId?: string }) {
  const { model } = useStore();
  const groups = useMemo(
    () => model.data.categoryGroups.filter((g) => !g.hidden).map((g) => ({ g, cats: model.data.categories.filter((c) => c.groupId === g.id && !c.hidden) })),
    [model],
  );
  const others = model.data.accounts.filter((a) => !a.closed && a.id !== excludeAccountId);
  return (
    <>
      {groups.map(({ g, cats }) => (
        <optgroup key={g.id} label={g.name}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Transfer to or from account">
        {others.map((a) => (
          <option key={a.id} value={TRANSFER + a.id}>
            {model.accountLabel(a.id)}
          </option>
        ))}
      </optgroup>
    </>
  );
}

export function CategorySelect({ tx }: { tx: Transaction }) {
  const { setCategory, markTransfer } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <select
      className={tx.categoryId ? '' : 'uncat'}
      value={tx.categoryId ?? ''}
      disabled={busy}
      aria-label={'Category for ' + tx.payee}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        setBusy(true);
        const v = e.target.value;
        try {
          if (v.startsWith(TRANSFER)) await markTransfer(tx.id, v.slice(TRANSFER.length));
          else await setCategory(tx.id, v || null);
        } catch (err) {
          alert((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <option value="">Uncategorized</option>
      <CategoryOptions excludeAccountId={tx.accountId} />
    </select>
  );
}

type Selection = { selected: Set<string>; onToggle: (id: string, range: boolean) => void };

export function TxList({ txs, pageSize = 150, showAccount = true, selection }: { txs: Transaction[]; pageSize?: number; showAccount?: boolean; selection?: Selection }) {
  const { model } = useStore();
  const [limit, setLimit] = useState(pageSize);
  const shown = txs.slice(0, limit);
  const days = useMemo(() => {
    const out: { date: string; txs: Transaction[]; total: number }[] = [];
    for (const t of shown) {
      let d = out[out.length - 1];
      if (!d || d.date !== t.date) out.push((d = { date: t.date, txs: [], total: 0 }));
      d.txs.push(t);
      d.total += t.amount;
    }
    return out;
  }, [shown]);

  const catCell = (t: Transaction) => {
    const acct = model.accountById.get(t.accountId);
    if (t.splits)
      return (
        <span>
          <span className="split-tag">Split</span>
          {[...new Set(t.splits.map((s) => model.categoryName(s.categoryId)))].join(', ')}
        </span>
      );
    if (t.startingBalance) return <span className="transfer-tag">Starting balance</span>;
    if (t.transferAccountId && !t.categoryId) return <span className="transfer-tag">Transfer · {model.accountLabel(t.transferAccountId)}</span>;
    if (acct?.offBudget && !t.categoryId) return <span className="transfer-tag">Off budget</span>;
    return <CategorySelect tx={t} />;
  };

  if (!txs.length) return <p className="muted empty">No transactions match.</p>;
  return (
    <div>
      {days.map((d, i) => (
        // A date can repeat if the list isn't sorted, so the index keeps keys unique.
        <div key={d.date + ':' + i}>
          <div className="tx-day">
            <span>{dayLabel(d.date)}</span>
            <span className="num">{money(d.total)}</span>
          </div>
          {d.txs.map((t) => (
            <div className={'tx-row' + (selection?.selected.has(t.id) ? ' picked' : '')} key={t.id}>
              <div className="tx-merchant">
                {selection &&
                  (editable(model, t) ? (
                    <input
                      type="checkbox"
                      className="tx-check"
                      checked={selection.selected.has(t.id)}
                      aria-label={'Select ' + (t.payee || 'transaction')}
                      // Click rather than change, so shift-click can select a range.
                      onClick={(e) => {
                        e.stopPropagation();
                        selection.onToggle(t.id, e.shiftKey);
                      }}
                      onChange={() => {}}
                    />
                  ) : (
                    <span className="tx-check" title="Splits, starting balances and transfers can't be bulk edited" />
                  ))}
                <Avatar name={t.payee || '?'} />
                <div>
                  <div className="name" title={t.notes || t.payee}>{t.payee || '(no payee)'}</div>
                  <div className="sub">{t.splits ? 'Split' : t.transferAccountId && !t.categoryId ? 'Transfer' : model.categoryName(t.categoryId)}</div>
                </div>
              </div>
              <div className="tx-cat">{catCell(t)}</div>
              {showAccount ? <div className="tx-account" title={model.accountLabel(t.accountId)}>{model.accountLabel(t.accountId)}</div> : <div className="tx-account" />}
              <div className={'num ' + (t.amount > 0 ? 'pos' : '')}>{money(t.amount)}</div>
            </div>
          ))}
        </div>
      ))}
      {txs.length > limit && (
        <button className="link-btn" onClick={() => setLimit(limit + pageSize)}>
          Show more ({txs.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
