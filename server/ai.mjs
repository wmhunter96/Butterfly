// Suggests categories for uncategorized transactions. Payees that the budget
// already categorizes consistently are matched from history; the rest go to
// Claude with the budget's categories and past categorizations as context.
// Nothing is written here: the UI shows the suggestions for review first.
import Anthropic from '@anthropic-ai/sdk';
import { counterpartIndex, findCounterpart, TRANSFER_WORDS } from './transfers.mjs';

// Haiku is the cheapest Claude model and plenty for picking a category.
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';
// Haiku 4.5 takes no effort setting or adaptive thinking; larger models get both, plus refusal fallbacks.
const SMALL = MODEL.startsWith('claude-haiku');
const MAX_GROUPS = 400;
const BATCH = 60;
const CONCURRENCY = 3;
const EXAMPLES = 250;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
const anthropic = () => (client ??= new Anthropic());

const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// A suggestion's categoryId is either a category id or "transfer:<account id>".
const TRANSFER = 'transfer:';
export const transferTarget = (id) => (id?.startsWith(TRANSFER) ? id.slice(TRANSFER.length) : null);

// Money in and money out from the same payee (a refund, a Venmo back) usually belong in different categories.
const flowKey = (payee, amount) => (norm(payee) ? norm(payee) + (amount > 0 ? '|in' : '|out') : '');

/** payee -> { total, byCat: Map(categoryId -> count) } from already-categorized transactions. */
function payeeHistory(data) {
  const hist = new Map();
  const add = (payee, amount, categoryId) => {
    const k = flowKey(payee, amount);
    if (!k || !categoryId) return;
    const h = hist.get(k) ?? { key: k, name: payee, total: 0, byCat: new Map() };
    h.total++;
    h.byCat.set(categoryId, (h.byCat.get(categoryId) ?? 0) + 1);
    hist.set(k, h);
  };
  for (const t of data.transactions) {
    if (t.startingBalance) continue;
    // Past transfers teach the payee too, so the next card payment is matched without asking Claude.
    if (t.transferAccountId) {
      if (!t.categoryId && !t.splits) add(t.payee, t.amount, TRANSFER + t.transferAccountId);
      continue;
    }
    if (t.splits) t.splits.forEach((s) => add(t.payee, s.amount, s.categoryId));
    else add(t.payee, t.amount, t.categoryId);
  }
  return hist;
}

const topCategory = (h) => [...h.byCat.entries()].sort((a, b) => b[1] - a[1])[0];

export async function suggestCategories(data, txIds) {
  const cats = data.categories.filter((c) => !c.hidden);
  const catIds = new Set(cats.map((c) => c.id));
  const groupName = new Map(data.categoryGroups.map((g) => [g.id, g.name]));
  const acctName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const openAccts = data.accounts.filter((a) => !a.closed);
  const hist = payeeHistory(data);
  // A transfer can go to any open account other than the transaction's own.
  const validFor = (id, txs) => {
    const to = transferTarget(id);
    if (!to) return catIds.has(id);
    return openAccts.some((a) => a.id === to) && txs.every((t) => t.accountId !== to);
  };

  const wanted = new Set(txIds);
  const pending = data.transactions.filter((t) => wanted.has(t.id) && !t.categoryId && !t.splits && !t.transferAccountId);

  // Money that left one account and arrived in another (a card payment) is a transfer, not income or spending.
  const transfers = [];
  const paired = new Set();
  const index = counterpartIndex(data);
  for (const t of pending) {
    if (paired.has(t.id)) continue;
    const c = findCounterpart(index, t, null, paired);
    if (!c) continue;
    paired.add(t.id).add(c.id);
    const worded = TRANSFER_WORDS.test(t.payee) || TRANSFER_WORDS.test(c.payee);
    const dir = t.amount < 0 ? 'in on' : 'out of';
    transfers.push({
      key: 'xfer:' + t.id,
      payee: t.payee,
      payeeId: t.payeeId ?? null,
      txs: [t],
      categoryId: TRANSFER + c.accountId,
      counterpartId: c.id,
      confidence: worded ? 'high' : 'medium',
      reason: `Same amount ${dir} ${acctName.get(c.accountId) ?? 'another account'} on ${c.date}`,
      source: 'transfer',
    });
  }

  // Group the rest by payee: one decision per merchant.
  const groups = new Map();
  for (const t of pending) {
    if (paired.has(t.id)) continue;
    const k = flowKey(t.payee, t.amount) || 'tx:' + t.id;
    const g = groups.get(k) ?? { key: k, payee: t.payee, payeeId: t.payeeId ?? null, txs: [] };
    g.txs.push(t);
    groups.set(k, g);
  }
  const all = [...groups.values()].sort((a, b) => b.txs.length - a.txs.length);
  const list = all.slice(0, MAX_GROUPS);

  const out = [...transfers];
  const forAi = [];
  for (const g of list) {
    const h = hist.get(g.key);
    const top = h && topCategory(h);
    if (top && validFor(top[0], g.txs) && h.total >= 2 && top[1] / h.total >= 0.75) {
      const what = transferTarget(top[0]) ? 'marked' : 'categorized';
      out.push({ ...g, categoryId: top[0], confidence: 'high', reason: `You ${what} ${top[1]} of ${h.total} past ${g.payee} transactions this way`, source: 'history' });
    } else forAi.push(g);
  }

  let aiError = null;
  if (forAi.length && !aiConfigured()) {
    aiError = 'Set ANTHROPIC_API_KEY on the container to get AI suggestions for new merchants.';
    forAi.forEach((g) => out.push({ ...g, categoryId: null, confidence: 'low', reason: '', source: 'none' }));
  } else if (forAi.length) {
    const catalog = cats
      .map((c) => `${c.id} | ${groupName.get(c.groupId) ?? ''} > ${c.name}${c.isIncome ? ' (income)' : ''}`)
      .concat(openAccts.map((a) => `${TRANSFER}${a.id} | Transfer > ${a.name}`))
      .join('\n');
    const choiceIds = [...catIds, ...openAccts.map((a) => TRANSFER + a.id)];
    const examples = [...hist.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, EXAMPLES)
      .map((h) => {
        const [cid, n] = topCategory(h);
        const c = data.categories.find((x) => x.id === cid);
        const to = transferTarget(cid);
        const label = to ? (acctName.has(to) ? 'Transfer > ' + acctName.get(to) : null) : c?.name;
        return label ? `${h.name} (money ${h.key.endsWith('|in') ? 'in' : 'out'}) -> ${label} (${n}x)` : null;
      })
      .filter(Boolean)
      .join('\n');
    const system = [
      'You categorize bank transactions for a personal budget in Actual Budget.',
      'Pick the single best category for each merchant from the category list, using only the ids given.',
      'Negative amounts are money out (spending); positive amounts are money in (income or refunds). Income categories only fit money in.',
      'Money moving between the household\'s own accounts is a transfer, not income or spending: a credit card or loan payment (on either the bank or the card side), or a move to savings or investing. Use the matching "transfer:" id for the OTHER account, never the account the transaction is in. Only pick a transfer when the description clearly names a payment or one of these accounts.',
      'Match how this household has categorized similar merchants before (examples below). If you cannot tell what a merchant is, use "none" rather than guessing.',
      'confidence: high when the merchant is clear and the category is obvious; medium when it is a reasonable guess; low when unsure.',
      'reason: a few words a person would find useful, e.g. "Grocery chain" or "Like your other gas stations".',
      '',
      'Categories (id | group > name):',
      catalog,
      '',
      'Past categorizations (merchant -> category):',
      examples || '(none yet)',
    ].join('\n');

    const batches = [];
    for (let i = 0; i < forAi.length; i += BATCH) batches.push(forAi.slice(i, i + BATCH));
    const results = new Map();
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          const r = await classify(system, batch, acctName, choiceIds);
          r.forEach((v, k) => results.set(k, v));
        } catch (err) {
          console.error('AI categorization failed:', err);
          aiError = err instanceof Anthropic.AuthenticationError ? 'Claude rejected the API key (ANTHROPIC_API_KEY).' : 'AI request failed: ' + (err?.message || err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    for (const g of forAi) {
      const r = results.get(g.key);
      const categoryId = r && validFor(r.categoryId, g.txs) ? r.categoryId : null;
      out.push({ ...g, categoryId, confidence: categoryId ? r.confidence : 'low', reason: r?.reason ?? '', source: categoryId ? 'ai' : 'none' });
    }
  }

  return {
    groups: out.map(({ txs, ...g }) => ({
      ...g,
      txIds: txs.map((t) => t.id),
      count: txs.length,
      total: Math.round(txs.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    })),
    remaining: all.length - list.length,
    aiError,
    model: MODEL,
  };
}

async function classify(system, batch, acctName, catIds) {
  // Short ids keep the output small; the map turns them back into groups.
  const ids = new Map(batch.map((g, i) => ['m' + i, g]));
  const lines = [...ids].map(([id, g]) => {
    const amounts = g.txs.slice(0, 4).map((t) => t.amount.toFixed(2)).join(', ');
    const notes = [...new Set(g.txs.map((t) => t.notes).filter(Boolean))].slice(0, 2).join(' / ');
    const accts = [...new Set(g.txs.map((t) => acctName.get(t.accountId)).filter(Boolean))].slice(0, 2).join(', ');
    return `${id}: "${g.payee || '(no payee)'}" x${g.txs.length}; amounts ${amounts}${notes ? `; notes: ${notes}` : ''}${accts ? `; account: ${accts}` : ''}`;
  });

  const res = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...(SMALL ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', thinking: { type: 'adaptive' } }),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    output_config: {
      ...(SMALL ? {} : { effort: 'medium' }),
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['suggestions'],
          properties: {
            suggestions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'categoryId', 'confidence', 'reason'],
                properties: {
                  id: { type: 'string', enum: [...ids.keys()] },
                  categoryId: { type: 'string', enum: [...catIds, 'none'] },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    messages: [{ role: 'user', content: 'Categorize each merchant:\n' + lines.join('\n') }],
  });

  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);
  const out = new Map();
  for (const s of parsed.suggestions ?? []) {
    const g = ids.get(s.id);
    if (g) out.set(g.key, s);
  }
  return out;
}
