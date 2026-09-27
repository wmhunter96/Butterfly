import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { ACCOUNT_TYPES } from '../lib/model';
import { money } from '../lib/format';
import { Card, PageHeader } from '../components/ui';
import type { AccountType, Property, Settings } from '../types';

export function SettingsPage() {
  const { model, saveSettings, demo } = useStore();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(model.settings));
  const [saved, setSaved] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(model.settings);

  const setProp = (i: number, patch: Partial<Property>) => setDraft({ ...draft, properties: draft.properties.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const toggleIn = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const accounts = model.data.accounts.filter((a) => !a.closed);

  return (
    <div className="page">
      <PageHeader title="Settings" />
      <div className="settings-bar">
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={async () => {
            await saveSettings(draft);
            setSaved('Saved');
            setTimeout(() => setSaved(null), 2000);
          }}
        >
          Save changes
        </button>
        {dirty && <button className="btn" onClick={() => setDraft(structuredClone(model.settings))}>Discard</button>}
        {saved && <span className="pos small">{saved}</span>}
        {demo && <span className="muted small">Demo mode: set ACTUAL_SERVER_URL, ACTUAL_PASSWORD and ACTUAL_SYNC_ID to use your own budget.</span>}
      </div>

      <Card title="Properties">
        <p className="muted small" style={{ marginTop: 0 }}>
          Each property gets its own page. Pick the categories that belong to it (rent income, mortgage, repairs, taxes). Turn on “net only” for rentals so only the profit or loss reaches your main cash flow and spending.
        </p>
        {draft.properties.map((p, i) => (
          <div className="prop-editor" key={p.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" value={p.name} onChange={(e) => setProp(i, { name: e.target.value })} style={{ flex: 1 }} aria-label="Property name" />
              <button className="icon-btn" aria-label="Remove property" onClick={() => setDraft({ ...draft, properties: draft.properties.filter((_, j) => j !== i) })}>
                <Trash2 size={15} />
              </button>
            </div>
            <label className="checks">
              <input type="checkbox" checked={p.netOnly} onChange={(e) => setProp(i, { netOnly: e.target.checked })} /> Net only (rental): count only net cash flow in the main budget views
            </label>
            <div>
              <div className="field-label">Categories</div>
              <div className="checks">
                {model.data.categoryGroups.map((g) =>
                  model.data.categories
                    .filter((c) => c.groupId === g.id)
                    .map((c) => (
                      <label key={c.id}>
                        <input type="checkbox" checked={p.categoryIds.includes(c.id)} onChange={() => setProp(i, { categoryIds: toggleIn(p.categoryIds, c.id) })} />
                        {c.name} <span className="muted small">{g.name}</span>
                      </label>
                    )),
                )}
              </div>
            </div>
            <div className="grid-2">
              <div>
                <div className="field-label">Value accounts</div>
                <div className="checks">
                  {accounts.map((a) => (
                    <label key={a.id}>
                      <input type="checkbox" checked={p.valueAccountIds.includes(a.id)} onChange={() => setProp(i, { valueAccountIds: toggleIn(p.valueAccountIds, a.id) })} />
                      {model.accountLabel(a.id)}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="field-label">Mortgage / loan accounts</div>
                <div className="checks">
                  {accounts.map((a) => (
                    <label key={a.id}>
                      <input type="checkbox" checked={p.loanAccountIds.includes(a.id)} onChange={() => setProp(i, { loanAccountIds: toggleIn(p.loanAccountIds, a.id) })} />
                      {model.accountLabel(a.id)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
        <button
          className="btn"
          onClick={() =>
            setDraft({ ...draft, properties: [...draft.properties, { id: 'p-' + Date.now().toString(36), name: 'New property', categoryIds: [], valueAccountIds: [], loanAccountIds: [], netOnly: true }] })
          }
        >
          <Plus size={15} /> Add property
        </button>
      </Card>

      <Card title="Accounts">
        <p className="muted small" style={{ marginTop: 0 }}>
          Bank is shown in front of the account name everywhere (like “Kinecta · Savings”) and lets you group the Accounts page by bank. It's filled in from SimpleFIN when Actual knows it. Types decide where each account shows up on Net worth, Accounts and Loans; they were guessed from account names.
        </p>
        <datalist id="bank-names">
          {[...new Set(Object.values(draft.accountBanks).filter(Boolean))].sort().map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {accounts.map((a) => {
          const type = draft.accountTypes[a.id];
          return (
            <div className="settings-row accounts" key={a.id}>
              <span>
                {a.name} <span className="muted small">{money(a.balance)}</span>
              </span>
              <input
                type="text"
                list="bank-names"
                placeholder="Bank"
                aria-label={'Bank for ' + a.name}
                value={draft.accountBanks[a.id] ?? ''}
                onChange={(e) => {
                  // Keep an empty string so clearing a bank also hides the one SimpleFIN reported.
                  setDraft({ ...draft, accountBanks: { ...draft.accountBanks, [a.id]: e.target.value } });
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={type} style={{ flex: 1 }} onChange={(e) => setDraft({ ...draft, accountTypes: { ...draft.accountTypes, [a.id]: e.target.value as AccountType } })}>
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                {(type === 'mortgage' || type === 'loan') && (
                  <input
                    type="number"
                    step="0.01"
                    placeholder="APR %"
                    style={{ width: 80 }}
                    value={draft.loanRates[a.id] ?? ''}
                    onChange={(e) => {
                      const loanRates = { ...draft.loanRates };
                      if (e.target.value) loanRates[a.id] = Number(e.target.value);
                      else delete loanRates[a.id];
                      setDraft({ ...draft, loanRates });
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
