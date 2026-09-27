import { useState, type ReactNode } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { PRESETS, periodLabel, presetPeriod, shiftPeriod } from '../lib/period';
import { dateTime, money, pct } from '../lib/format';
import type { Item } from '../lib/finance';

export function PageHeader({ title, icon, children }: { title: string; icon?: ReactNode; children?: ReactNode }) {
  const { model, syncBanks, syncing, demo } = useStore();
  const meta = model.data.meta;
  return (
    <header className="page-header">
      <div className="page-title">
        <h1>
          {icon}
          {title}
        </h1>
        <p className="muted small">
          {demo ? 'Demo data · ' : 'Synced with Actual ' + dateTime(meta.syncedAt) + ' · '}
          Banks synced {dateTime(meta.lastBankSync)}
        </p>
      </div>
      <div className="page-actions">
        {children}
        <PeriodPicker />
        <button className="btn" onClick={syncBanks} disabled={syncing} title="Run SimpleFIN bank sync in Actual">
          <RefreshCw size={15} className={syncing ? 'spin' : ''} />
          <span className="hide-sm">{syncing ? 'Syncing…' : 'Sync banks'}</span>
        </button>
      </div>
    </header>
  );
}

export function PeriodPicker() {
  const { period, setPeriod, model } = useStore();
  const [open, setOpen] = useState(false);
  const label = PRESETS.find((p) => p.id === period.preset)?.label ?? 'Custom';
  return (
    <div className="period">
      <button className="icon-btn" aria-label="Previous period" onClick={() => setPeriod(shiftPeriod(period, -1))}>
        <ChevronLeft size={16} />
      </button>
      <span className="period-label">{periodLabel(period)}</span>
      <button className="icon-btn" aria-label="Next period" onClick={() => setPeriod(shiftPeriod(period, 1))}>
        <ChevronRight size={16} />
      </button>
      <div className="dropdown">
        <button className="btn" onClick={() => setOpen(!open)}>
          <CalendarDays size={15} /> {label} <ChevronDown size={14} />
        </button>
        {open && (
          <>
            <div className="scrim" onClick={() => setOpen(false)} />
            <div className="menu">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={p.id === period.preset ? 'active' : ''}
                  onClick={() => {
                    setPeriod(presetPeriod(p.id, new Date(), model.earliest));
                    setOpen(false);
                  }}
                >
                  {p.label}
                </button>
              ))}
              <div className="menu-custom">
                <label>
                  From
                  <input type="date" value={period.start} onChange={(e) => e.target.value && setPeriod({ preset: 'custom', start: e.target.value, end: period.end })} />
                </label>
                <label>
                  To
                  <input type="date" value={period.end} onChange={(e) => e.target.value && setPeriod({ preset: 'custom', start: period.start, end: e.target.value })} />
                </label>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, dot, tone }: { label: string; value: ReactNode; sub?: ReactNode; dot?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="card stat">
      <div className="stat-label">
        {dot && <span className="dot" style={{ background: dot }} />}
        {label}
      </div>
      <div className={'stat-value ' + (tone ?? '')}>{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'card ' + (className ?? '')}>
      {(title || actions) && (
        <div className="card-head">
          <h2>{title}</h2>
          <div className="card-actions">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

/** Ranked rows with a proportional bar; optional expandable children. */
export function BarList({ items, total, onSelect, selected, sign = 1, max: maxRows }: { items: Item[]; total: number; onSelect?: (it: Item) => void; selected?: Set<string>; sign?: 1 | -1; max?: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const top = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  const visible = maxRows && !showAll ? items.slice(0, maxRows) : items;
  const row = (it: Item, child = false) => (
    <div key={it.key}>
      <div
        className={'bar-row' + (child ? ' child' : '') + (selected?.has(it.key) ? ' selected' : '') + (onSelect || it.children?.length ? ' clickable' : '')}
        onClick={() => {
          if (it.children?.length && !onSelect) {
            const n = new Set(expanded);
            if (n.has(it.key)) n.delete(it.key);
            else n.add(it.key);
            setExpanded(n);
          } else onSelect?.(it);
        }}
      >
        <div className="bar-top">
          <span className="bar-name">
            <span className="dot" style={{ background: it.color }} />
            {it.label}
          </span>
          <span className="bar-amt">
            {money(sign * it.amount)}
            <span className="muted pct">{pct(total ? it.amount / total : 0)}</span>
          </span>
        </div>
        <div className="bar-track">
          <div className="bar-fill" style={{ width: `${Math.max(0, (it.amount / top) * 100)}%`, background: it.color }} />
        </div>
      </div>
      {expanded.has(it.key) && it.children?.map((c) => row(c, true))}
    </div>
  );
  return (
    <div className="bar-list">
      {visible.map((it) => row(it))}
      {maxRows && items.length > maxRows && (
        <button className="link-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
      {!items.length && <p className="muted empty">Nothing in this period.</p>}
    </div>
  );
}

const AVATAR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#c98500', '#d55181', '#008300', '#4a3aa7', '#e34948'];
export function Avatar({ name }: { name: string }) {
  const clean = name.replace(/^(sq|tst|paypal)\s*\*\s*/i, '').trim() || '?';
  let h = 0;
  for (const ch of clean) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="avatar" style={{ background: AVATAR_COLORS[h % AVATAR_COLORS.length] }} aria-hidden>
      {clean[0].toUpperCase()}
    </span>
  );
}

export function ChartTooltip({ active, payload, label, formatLabel }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string; formatLabel?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{formatLabel ? formatLabel(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="tooltip-row">
          <span className="dot" style={{ background: p.color }} />
          <span>{p.name}</span>
          <b>{money(p.value)}</b>
        </div>
      ))}
    </div>
  );
}
