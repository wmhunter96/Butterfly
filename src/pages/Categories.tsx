import { useMemo, useState, type FormEvent } from 'react';
import { Check, Home, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { Card, PageHeader } from '../components/ui';
import type { Category, CategoryGroup, FinanceData } from '../types';

/** Same rule as guessProperties: a group named with a street number is a property. */
const isPropertyName = (name: string) => /^\d+\s+\S+/.test(name.trim());

type Deleting = { kind: 'group'; group: CategoryGroup } | { kind: 'category'; category: Category };

function usageOf(data: FinanceData) {
  const n = new Map<string, number>();
  const bump = (id: string | null) => id && n.set(id, (n.get(id) ?? 0) + 1);
  for (const t of data.transactions) {
    if (t.splits) t.splits.forEach((s) => bump(s.categoryId));
    else bump(t.categoryId);
  }
  return n;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function CategoriesPage() {
  const { model, changeCategories } = useStore();
  const { categoryGroups, categories } = model.data;
  const usage = useMemo(() => usageOf(model.data), [model]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting | null>(null);
  const [newGroup, setNewGroup] = useState('');

  const run = async (method: 'POST' | 'PATCH' | 'DELETE', path: string, body: object = {}) => {
    setBusy(true);
    setError(null);
    try {
      await changeCategories(method, path, body);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Income groups last, the way Actual's budget lists them.
  const groups = [...categoryGroups.filter((g) => !g.isIncome), ...categoryGroups.filter((g) => g.isIncome)];

  return (
    <div className="page">
      <PageHeader title="Categories" />
      <Card>
        <p className="muted small" style={{ marginTop: 0 }}>
          Changes here are saved to Actual and show up right away in the category picker and in Categorize with AI. Name a group with a street address (like “123 Main St”) and it gets its own property page. Rent you collect goes in that property's group; rent you pay goes in a group like Bills.
        </p>
        <form
          className="cat-add"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (newGroup.trim() && (await run('POST', '/api/category-groups', { name: newGroup }))) setNewGroup('');
          }}
        >
          <input type="text" placeholder="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} disabled={busy} aria-label="New group name" />
          <button className="btn" type="submit" disabled={busy || !newGroup.trim()}>
            <Plus size={15} /> Add group
          </button>
        </form>
        {error && !deleting && <p className="neg small" role="alert" style={{ marginBottom: 0 }}>{error}</p>}
      </Card>

      {groups.map((g) => {
        const cats = categories.filter((c) => c.groupId === g.id);
        const moveTargets = categoryGroups.filter((x) => x.isIncome === g.isIncome && x.id !== g.id);
        return (
          <Card
            key={g.id}
            className="cat-group"
            title={
              <span className="cat-group-title">
                <EditableName value={g.name} disabled={busy} label="group" onSave={(name) => run('PATCH', '/api/category-groups/' + encodeURIComponent(g.id), { name })} />
                {isPropertyName(g.name) && !g.isIncome && (
                  <span className="tag">
                    <Home size={11} /> Property
                  </span>
                )}
                {g.isIncome && <span className="tag">Income</span>}
                {g.hidden && <span className="tag">Hidden</span>}
              </span>
            }
            actions={
              !g.isIncome && (
                <button className="icon-btn" aria-label={'Delete group ' + g.name} title="Delete group" disabled={busy} onClick={() => setDeleting({ kind: 'group', group: g })}>
                  <Trash2 size={15} />
                </button>
              )
            }
          >
            {cats.map((c) => (
              <div className="cat-row" key={c.id}>
                <div className="cat-name">
                  <EditableName value={c.name} disabled={busy} label="category" onSave={(name) => run('PATCH', '/api/categories/' + encodeURIComponent(c.id), { name })} />
                  {c.hidden && <span className="tag">Hidden</span>}
                </div>
                <span className="muted small cat-count">{plural(usage.get(c.id) ?? 0, 'transaction')}</span>
                <select
                  value=""
                  disabled={busy || !moveTargets.length}
                  aria-label={'Move ' + c.name + ' to another group'}
                  onChange={(e) => e.target.value && run('PATCH', '/api/categories/' + encodeURIComponent(c.id), { groupId: e.target.value })}
                >
                  <option value="">Move to…</option>
                  {moveTargets.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
                <button className="icon-btn" aria-label={'Delete ' + c.name} title="Delete category" disabled={busy} onClick={() => setDeleting({ kind: 'category', category: c })}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {!cats.length && <p className="muted small">No categories yet.</p>}
            <AddCategory disabled={busy} onAdd={(name) => run('POST', '/api/categories', { name, groupId: g.id })} />
          </Card>
        );
      })}

      {deleting && (
        <DeleteDialog
          deleting={deleting}
          usage={usage}
          busy={busy}
          error={error}
          onCancel={() => {
            setDeleting(null);
            setError(null);
          }}
          onConfirm={async (transferCategoryId) => {
            const path = deleting.kind === 'group' ? '/api/category-groups/' + encodeURIComponent(deleting.group.id) : '/api/categories/' + encodeURIComponent(deleting.category.id);
            if (await run('DELETE', path, { transferCategoryId })) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function EditableName({ value, onSave, disabled, label }: { value: string; onSave: (name: string) => Promise<boolean>; disabled: boolean; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null)
    return (
      <span className="editable">
        <span>{value}</span>
        <button className="icon-btn subtle" aria-label={`Rename ${label} ${value}`} title="Rename" disabled={disabled} onClick={() => setDraft(value)}>
          <Pencil size={13} />
        </button>
      </span>
    );
  const save = async () => {
    if (!draft.trim() || draft.trim() === value) return setDraft(null);
    if (await onSave(draft)) setDraft(null);
  };
  // A span, not a form: group names sit inside the card's heading.
  return (
    <span className="editable">
      <input
        type="text"
        autoFocus
        value={draft}
        disabled={disabled}
        aria-label={`New name for ${label} ${value}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      <button className="icon-btn" aria-label="Save name" disabled={disabled} onClick={save}>
        <Check size={14} />
      </button>
      <button className="icon-btn" aria-label="Cancel rename" onClick={() => setDraft(null)}>
        <X size={14} />
      </button>
    </span>
  );
}

function AddCategory({ onAdd, disabled }: { onAdd: (name: string) => Promise<boolean>; disabled: boolean }) {
  const [name, setName] = useState('');
  return (
    <form
      className="cat-add"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && (await onAdd(name))) setName('');
      }}
    >
      <input type="text" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} aria-label="New category name" />
      <button className="btn" type="submit" disabled={disabled || !name.trim()}>
        <Plus size={15} /> Add category
      </button>
    </form>
  );
}

/** Asks where the transactions go before deleting, the way Actual does. */
function DeleteDialog({
  deleting,
  usage,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  deleting: Deleting;
  usage: Map<string, number>;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (transferCategoryId: string | null) => void;
}) {
  const { model } = useStore();
  const { categoryGroups, categories } = model.data;
  const doomed = deleting.kind === 'group' ? categories.filter((c) => c.groupId === deleting.group.id) : [deleting.category];
  const doomedIds = new Set(doomed.map((c) => c.id));
  const isIncome = deleting.kind === 'group' ? deleting.group.isIncome : deleting.category.isIncome;
  const count = doomed.reduce((sum, c) => sum + (usage.get(c.id) ?? 0), 0);
  const name = deleting.kind === 'group' ? deleting.group.name : deleting.category.name;
  const [target, setTarget] = useState('');
  const options = categoryGroups
    .filter((g) => g.isIncome === isIncome)
    .map((g) => ({ g, cats: categories.filter((c) => c.groupId === g.id && !doomedIds.has(c.id)) }))
    .filter((x) => x.cats.length);

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={'Delete ' + name} onClick={(e) => e.stopPropagation()}>
        <h2>Delete {deleting.kind === 'group' ? 'group' : 'category'} “{name}”?</h2>
        {deleting.kind === 'group' && doomed.length > 0 && <p className="muted small">This also deletes its {plural(doomed.length, 'category')}: {doomed.map((c) => c.name).join(', ')}.</p>}
        {count > 0 ? (
          <>
            <p className="small">{plural(count, 'transaction')} {count === 1 ? 'is' : 'are'} filed here. Where should {count === 1 ? 'it' : 'they'} go?</p>
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Move transactions to" autoFocus>
              <option value="">Pick a category…</option>
              {options.map(({ g, cats }) => (
                <optgroup key={g.id} label={g.name}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {!options.length && <p className="neg small">There's no other {isIncome ? 'income' : 'spending'} category to move them to. Add one first.</p>}
          </>
        ) : (
          <p className="muted small">No transactions are filed here.</p>
        )}
        {error && <p className="neg small" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn danger" disabled={busy || (count > 0 && !target)} onClick={() => onConfirm(target || null)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}
