import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FinanceData, Settings } from './types';
import { buildModel, resolveSettings, type Model } from './lib/model';
import { presetPeriod, type Period } from './lib/period';

type Store = {
  model: Model;
  period: Period;
  setPeriod: (p: Period) => void;
  refresh: () => Promise<void>;
  syncBanks: () => Promise<void>;
  syncing: boolean;
  saveSettings: (s: Settings) => Promise<void>;
  setCategory: (txId: string, categoryId: string | null) => Promise<void>;
  /** Make a transaction a transfer to another account (linking the matching transaction there), then reload. */
  markTransfer: (txId: string, accountId: string) => Promise<void>;
  /** Add, rename, move or delete a category or group in Actual, then reload. Resolves to the id of anything created. */
  changeCategories: (method: 'POST' | 'PATCH' | 'DELETE', path: string, body: object) => Promise<string | null>;
  /** Reflect categories written elsewhere (AI review) without reloading from Actual. */
  categorized: (changes: { txId: string; categoryId: string }[]) => void;
  demo: boolean;
  ai: boolean;
  authRequired: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body as T;
}

const PERIOD_KEY = 'butterfly.period';
const loadPeriod = (): Period => {
  try {
    const p = JSON.parse(localStorage.getItem(PERIOD_KEY) || 'null');
    if (p?.preset && p.preset !== 'custom') return presetPeriod(p.preset);
    if (p?.start && p?.end) return p;
  } catch {
    /* ignore */
  }
  return presetPeriod('ytd');
};

export function StoreProvider({ children, session, onSignedOut }: { children: ReactNode; session: { demo: boolean; authRequired: boolean; ai?: boolean }; onSignedOut: () => void }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [saved, setSaved] = useState<Partial<Settings> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriodState] = useState<Period>(loadPeriod);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const [d, s] = await Promise.all([api<FinanceData>('/api/data' + (force ? '?refresh=1' : '')), api<Partial<Settings> | null>('/api/settings')]);
      setData(d);
      setSaved(s);
      setError(null);
    } catch (e) {
      if ((e as { status?: number }).status === 401) onSignedOut();
      else setError((e as Error).message);
    }
  }, [onSignedOut]);

  useEffect(() => {
    load();
  }, [load]);

  const settings = useMemo(() => (data ? resolveSettings(data, saved) : null), [data, saved]);
  const model = useMemo(() => (data && settings ? buildModel(data, settings) : null), [data, settings]);

  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(PERIOD_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };

  if (error && !data)
    return (
      <div className="fullscreen-msg">
        <h2>Couldn't load your data</h2>
        <p>{error}</p>
        <button className="btn primary" onClick={() => load(true)}>Try again</button>
      </div>
    );
  if (!model || !data) return <div className="fullscreen-msg"><div className="spinner" /></div>;

  const store: Store = {
    model,
    period,
    setPeriod,
    demo: session.demo,
    ai: Boolean(session.ai),
    authRequired: session.authRequired,
    refresh: () => load(true),
    syncing,
    async syncBanks() {
      setSyncing(true);
      try {
        await api('/api/sync', { method: 'POST' });
        await load(true);
      } catch (e) {
        alert((e as Error).message);
      } finally {
        setSyncing(false);
      }
    },
    async saveSettings(s) {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
      setSaved(s);
    },
    async setCategory(txId, categoryId) {
      await api('/api/transactions/' + encodeURIComponent(txId), { method: 'PATCH', body: JSON.stringify({ categoryId }) });
      setData({ ...data, transactions: data.transactions.map((t) => (t.id === txId ? { ...t, categoryId } : t)) });
    },
    async markTransfer(txId, accountId) {
      await api('/api/transactions/' + encodeURIComponent(txId) + '/transfer', { method: 'POST', body: JSON.stringify({ accountId }) });
      await load(true);
    },
    async changeCategories(method, path, body) {
      const { id } = await api<{ id: string | null }>(path, { method, body: JSON.stringify(body) });
      await load(true);
      return id;
    },
    categorized(changes) {
      const byId = new Map(changes.map((c) => [c.txId, c.categoryId]));
      setData({ ...data, transactions: data.transactions.map((t) => (byId.has(t.id) ? { ...t, categoryId: byId.get(t.id)! } : t)) });
    },
    async signOut() {
      await api('/api/logout', { method: 'POST' });
      onSignedOut();
    },
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export { api };
