import { iso, parseDate } from './format';

export type Preset = 'month' | 'last-month' | 'ytd' | 'last-year' | '3m' | '6m' | '12m' | 'all' | 'custom';

export type Period = { preset: Preset; start: string; end: string };

export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '3m', label: 'Last 3 months' },
  { id: '6m', label: 'Last 6 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last-year', label: 'Last year' },
  { id: 'all', label: 'All time' },
];

export function presetPeriod(preset: Preset, today = new Date(), earliest = '2000-01-01'): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  const t = iso(today);
  const monthsBack = (n: number) => ({ start: iso(new Date(y, m - n + 1, 1)), end: t });
  switch (preset) {
    case 'month':
      return { preset, start: iso(new Date(y, m, 1)), end: t };
    case 'last-month':
      return { preset, start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
    case '3m':
      return { preset, ...monthsBack(3) };
    case '6m':
      return { preset, ...monthsBack(6) };
    case '12m':
      return { preset, ...monthsBack(12) };
    case 'last-year':
      return { preset, start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
    case 'all':
      return { preset, start: earliest, end: t };
    case 'ytd':
    default:
      return { preset: 'ytd', start: `${y}-01-01`, end: t };
  }
}

/** Move a period backwards/forwards by its own length (month-aligned). */
export function shiftPeriod(p: Period, dir: -1 | 1): Period {
  const s = parseDate(p.start);
  const e = parseDate(p.end);
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
  const ns = new Date(s.getFullYear(), s.getMonth() + dir * months, 1);
  const ne = new Date(ns.getFullYear(), ns.getMonth() + months, 0);
  return { preset: 'custom', start: iso(ns), end: iso(ne) };
}

export function periodLabel(p: Period) {
  const f = (d: string) => parseDate(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const a = f(p.start);
  const b = f(p.end);
  return a === b ? a : `${a} – ${b}`;
}
