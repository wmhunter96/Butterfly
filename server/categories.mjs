// Checks for category edits, the same edits applied to demo data, and keeping saved
// property settings in step when groups and categories change.
import crypto from 'node:crypto';

/** An error the user can fix; the API answers it with 400. */
export const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Same rule as guessProperties in src/lib/model.ts: a group named with a street number is a property. */
export const isPropertyName = (name) => /^\d+\s+\S+/.test(name.trim());

export function cleanName(v) {
  const name = String(v ?? '').trim();
  if (!name) throw badRequest('Give it a name');
  if (name.length > 100) throw badRequest('That name is too long');
  return name;
}

/** Number of transactions (split lines included) filed under each category. */
export function categoryUsage(data) {
  const n = new Map();
  const bump = (id) => id && n.set(id, (n.get(id) ?? 0) + 1);
  for (const t of data.transactions) {
    if (t.splits) t.splits.forEach((s) => bump(s.categoryId));
    else bump(t.categoryId);
  }
  return n;
}

/**
 * Validates a delete of the given categories. Transactions have to go somewhere, so a target is
 * required when any of them are in use; it must survive the delete and be the same kind (income or expense).
 */
export function checkDeleteTarget(data, deletedIds, transferCategoryId, isIncome) {
  const usage = categoryUsage(data);
  const used = deletedIds.reduce((sum, id) => sum + (usage.get(id) ?? 0), 0);
  if (!transferCategoryId) {
    if (used) throw badRequest(`Pick a category for the ${used} transaction${used === 1 ? '' : 's'} filed here`);
    return null;
  }
  const target = data.categories.find((c) => c.id === transferCategoryId);
  if (!target || deletedIds.includes(target.id)) throw badRequest('Pick a category that is not being deleted');
  if (target.isIncome !== isIncome) throw badRequest('Move income to an income category, and spending to a spending category');
  return target.id;
}

// ---- demo mode: the same edits, in memory ----

const retarget = (data, fromIds, toId) => {
  const from = new Set(fromIds);
  for (const t of data.transactions) {
    if (from.has(t.categoryId)) t.categoryId = toId;
    t.splits?.forEach((s) => from.has(s.categoryId) && (s.categoryId = toId));
  }
};

export const demoEdits = {
  createGroup(data, name) {
    const id = crypto.randomUUID();
    data.categoryGroups.push({ id, name, isIncome: false, hidden: false });
    return id;
  },
  renameGroup(data, id, name) {
    const g = data.categoryGroups.find((x) => x.id === id);
    if (g) g.name = name;
  },
  deleteGroup(data, id, transferCategoryId) {
    const ids = data.categories.filter((c) => c.groupId === id).map((c) => c.id);
    retarget(data, ids, transferCategoryId);
    data.categories = data.categories.filter((c) => c.groupId !== id);
    data.categoryGroups = data.categoryGroups.filter((g) => g.id !== id);
  },
  createCategory(data, name, groupId, isIncome) {
    const id = crypto.randomUUID();
    data.categories.push({ id, name, groupId, isIncome, hidden: false });
    return id;
  },
  renameCategory(data, id, name) {
    const c = data.categories.find((x) => x.id === id);
    if (c) c.name = name;
  },
  moveCategory(data, id, groupId) {
    const c = data.categories.find((x) => x.id === id);
    if (!c) return;
    // Actual appends a moved category to the end of its new group.
    data.categories = [...data.categories.filter((x) => x !== c), { ...c, groupId }];
  },
  deleteCategory(data, id, transferCategoryId) {
    retarget(data, [id], transferCategoryId);
    data.categories = data.categories.filter((c) => c.id !== id);
  },
};

// ---- saved property settings ----

/**
 * Brings saved properties in line with a category change (before -> after). Without saved
 * settings the UI guesses properties from group names on every load, so there is nothing to do.
 *  - a new (or newly renamed) street-number group becomes a property;
 *  - a renamed group renames its property, unless the property was given its own name;
 *  - a deleted group removes its property;
 *  - categories follow their group into or out of that group's property, and income
 *    categories that name a property's street join it (as guessProperties does).
 * Returns the updated settings, or null when nothing changed.
 */
export function reconcileProperties(settings, before, after) {
  if (!settings?.properties) return null;
  const props = settings.properties.map((p) => ({ ...p, categoryIds: [...p.categoryIds] }));
  const beforeGroups = new Map(before.categoryGroups.map((g) => [g.id, g]));
  const afterGroups = new Map(after.categoryGroups.map((g) => [g.id, g]));
  const beforeCats = new Map(before.categories.map((c) => [c.id, c]));
  const afterCats = new Map(after.categories.map((c) => [c.id, c]));
  const byId = () => new Map(props.map((p) => [p.id, p]));

  // Groups
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i];
    const was = beforeGroups.get(p.id);
    const now = afterGroups.get(p.id);
    if (was && !now) props.splice(i, 1);
    else if (was && now && was.name !== now.name && p.name === was.name) p.name = now.name;
  }
  for (const g of after.categoryGroups) {
    const was = beforeGroups.get(g.id);
    const becameProperty = isPropertyName(g.name) && (!was || !isPropertyName(was.name));
    if (!g.isIncome && becameProperty && !byId().has(g.id)) {
      props.push({ id: g.id, name: g.name, categoryIds: after.categories.filter((c) => c.groupId === g.id).map((c) => c.id), valueAccountIds: [], loanAccountIds: [], netOnly: false });
    }
  }

  // Categories
  const gone = new Set([...beforeCats.keys()].filter((id) => !afterCats.has(id)));
  for (const p of props) p.categoryIds = p.categoryIds.filter((id) => !gone.has(id));
  const map = byId();
  for (const c of after.categories) {
    const was = beforeCats.get(c.id);
    if (was && was.groupId === c.groupId) continue;
    if (was) {
      const from = map.get(was.groupId);
      if (from) from.categoryIds = from.categoryIds.filter((id) => id !== c.id);
    }
    const to = map.get(c.groupId);
    if (to && !to.categoryIds.includes(c.id)) to.categoryIds.push(c.id);
    if (!was && c.isIncome) {
      for (const p of props) {
        const street = norm(p.name).split(' ').slice(0, 2).join(' ');
        if (isPropertyName(p.name) && norm(c.name).includes(street) && !p.categoryIds.includes(c.id)) p.categoryIds.push(c.id);
      }
    }
  }

  const next = { ...settings, properties: props };
  return JSON.stringify(next) === JSON.stringify(settings) ? null : next;
}
