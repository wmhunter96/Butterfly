import { useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { api, useStore } from '../store';
import { money } from '../lib/format';
import { Avatar } from './ui';
import { TRANSFER } from './TxList';

type Suggestion = {
  key: string;
  payee: string;
  payeeId: string | null;
  txIds: string[];
  count: number;
  total: number;
  categoryId: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  source: 'history' | 'ai' | 'transfer' | 'none';
};
type SuggestResult = { groups: Suggestion[]; remaining: number; aiError: string | null };
type Choice = { categoryId: string; accept: boolean; rule: boolean };

/** Suggest categories for a set of uncategorized transactions, let the user review, then write the approved ones to Actual. */
export function AiCategorize({ txIds, onClose }: { txIds: string[]; onClose: () => void }) {
  const { model, categorized, refresh, demo } = useStore();
  const [state, setState] = useState<'idle' | 'loading' | 'review' | 'applying' | 'done'>('idle');
  const [result, setResult] = useState<SuggestResult | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');

  const groups = useMemo(
    () => model.data.categoryGroups.filter((g) => !g.hidden).map((g) => ({ g, cats: model.data.categories.filter((c) => c.groupId === g.id && !c.hidden) })),
    [model],
  );
  const accounts = model.data.accounts.filter((a) => !a.closed);
  const txAccount = useMemo(() => new Map(model.data.transactions.map((t) => [t.id, t.accountId])), [model]);

  const run = async () => {
    setState('loading');
    setError('');
    try {
      const r = await api<SuggestResult>('/api/ai/suggest', { method: 'POST', body: JSON.stringify({ txIds }) });
      setResult(r);
      setChoices(
        Object.fromEntries(r.groups.map((g) => [g.key, { categoryId: g.categoryId ?? '', accept: !!g.categoryId && g.confidence !== 'low', rule: false }])),
      );
      setState('review');
    } catch (e) {
      setError((e as Error).message);
      setState('idle');
    }
  };

  const set = (key: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  const accepted = (result?.groups ?? []).filter((g) => choices[g.key]?.accept && choices[g.key].categoryId);
  const txCount = accepted.reduce((n, g) => n + g.count, 0);

  const apply = async () => {
    setState('applying');
    setError('');
    const isTransfer = (g: Suggestion) => choices[g.key].categoryId.startsWith(TRANSFER);
    const changes = accepted.filter((g) => !isTransfer(g)).flatMap((g) => g.txIds.map((txId) => ({ txId, categoryId: choices[g.key].categoryId })));
    const transfers = accepted.filter(isTransfer).flatMap((g) => g.txIds.map((txId) => ({ txId, accountId: choices[g.key].categoryId.slice(TRANSFER.length) })));
    const rules = accepted
      .filter((g) => g.payeeId && choices[g.key].rule && !isTransfer(g))
      .map((g) => ({ payeeId: g.payeeId!, categoryId: choices[g.key].categoryId }));
    try {
      const r = await api<{ updated: number; transfers: number; rules: number; rulesFailed: number }>('/api/ai/apply', {
        method: 'POST',
        body: JSON.stringify({ changes, transfers, rules }),
      });
      if (transfers.length) await refresh();
      else categorized(changes);
      const parts = [
        r.updated && `categorized ${r.updated} transaction${r.updated === 1 ? '' : 's'}`,
        r.transfers && `marked ${r.transfers} as transfer${r.transfers === 1 ? '' : 's'}`,
      ].filter(Boolean);
      const said = parts.join(' and ') || 'nothing changed';
      setSummary(
        said[0].toUpperCase() + said.slice(1) +
          (r.rules ? ` and added ${r.rules} payee rule${r.rules === 1 ? '' : 's'} in Actual` : '') +
          (r.rulesFailed ? `. ${r.rulesFailed} rule${r.rulesFailed === 1 ? '' : 's'} could not be created.` : '.'),
      );
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('review');
    }
  };

  const allOn = result?.groups.filter((g) => choices[g.key]?.categoryId).every((g) => choices[g.key].accept);

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <b>
          <Sparkles size={15} /> Categorize with AI
        </b>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {(state === 'idle' || state === 'loading') && (
        <div className="ai-intro">
          <p className="muted small">
            Suggests a category for each merchant among these {txIds.length} uncategorized transactions, using your categories and how you've categorized
            before. Card payments and moves between your own accounts are suggested as transfers, so they stay out of income and spending. Nothing changes
            in Actual until you approve.
          </p>
          <button className="btn primary" onClick={run} disabled={state === 'loading' || !txIds.length}>
            <Sparkles size={15} className={state === 'loading' ? 'spin' : ''} />
            {state === 'loading' ? 'Thinking…' : 'Suggest categories'}
          </button>
        </div>
      )}

      {error && <p className="neg small">{error}</p>}

      {state === 'done' && (
        <div className="ai-intro">
          <p className="small">{summary}</p>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      )}

      {result && (state === 'review' || state === 'applying') && (
        <>
          {result.aiError && <p className="small" style={{ color: 'var(--accent)' }}>{result.aiError}</p>}
          {!result.groups.length && <p className="muted small">Nothing to categorize here.</p>}
          {!!result.groups.length && (
            <div className="ai-row ai-row-head small muted">
              <input type="checkbox" aria-label="Select all" checked={!!allOn} onChange={(e) => result.groups.forEach((g) => choices[g.key]?.categoryId && set(g.key, { accept: e.target.checked }))} />
              <span>Merchant</span>
              <span>Category</span>
              <span className="ai-rule-col" title="Create a rule in Actual so future transactions from this payee are categorized automatically">Always</span>
            </div>
          )}
          <div className="ai-list">
            {result.groups.map((g) => {
              const c = choices[g.key];
              return (
                <div className={'ai-row' + (c.accept ? '' : ' off')} key={g.key}>
                  <input type="checkbox" aria-label={'Apply to ' + g.payee} checked={c.accept} disabled={!c.categoryId} onChange={(e) => set(g.key, { accept: e.target.checked })} />
                  <div className="ai-merchant">
                    <Avatar name={g.payee || '?'} />
                    <div>
                      <div className="name">{g.payee || '(no payee)'}</div>
                      <div className="sub">
                        {g.source === 'transfer' ? model.accountById.get(txAccount.get(g.txIds[0]) ?? '')?.name : `${g.count} ×`} ·{' '}
                        {money(g.total)}
                        {g.reason && <> · {g.reason}</>}
                      </div>
                    </div>
                  </div>
                  <div className="ai-cat">
                    <select value={c.categoryId} onChange={(e) => set(g.key, { categoryId: e.target.value, accept: !!e.target.value })} aria-label={'Category for ' + g.payee}>
                      <option value="">Choose…</option>
                      {groups.map(({ g: grp, cats }) => (
                        <optgroup key={grp.id} label={grp.name}>
                          {cats.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                          ))}
                        </optgroup>
                      ))}
                      <optgroup label="Transfer to or from account">
                        {accounts.filter((a) => !g.txIds.some((id) => txAccount.get(id) === a.id)).map((a) => (
                          <option key={a.id} value={TRANSFER + a.id}>{a.name}</option>
                        ))}
                      </optgroup>
                    </select>
                    {g.categoryId && (
                      <span className={'conf ' + (g.source === 'history' || g.source === 'transfer' ? 'history' : g.confidence)}>
                        {g.source === 'history' ? 'past' : g.source === 'transfer' ? 'match' : g.confidence}
                      </span>
                    )}
                  </div>
                  <div className="ai-rule-col">
                    {g.payeeId && !demo && !c.categoryId.startsWith(TRANSFER) ? (
                      <input type="checkbox" aria-label={'Always categorize ' + g.payee + ' this way'} checked={c.rule} disabled={!c.categoryId} onChange={(e) => set(g.key, { rule: e.target.checked, accept: e.target.checked || c.accept })} />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {result.remaining > 0 && <p className="muted small">{result.remaining} more merchants weren't included. Apply these, then run it again.</p>}
          <div className="ai-foot">
            <span className="muted small">
              {accepted.length} merchant{accepted.length === 1 ? '' : 's'} · {txCount} transaction{txCount === 1 ? '' : 's'}
            </span>
            <button className="btn primary" onClick={apply} disabled={!accepted.length || state === 'applying'}>
              {state === 'applying' ? 'Saving…' : `Apply ${txCount}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
