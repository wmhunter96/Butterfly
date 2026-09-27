const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const money = (n: number) => usd.format(n);
export const money0 = (n: number) => usd0.format(n);
export const moneyCompact = (n: number) => compact.format(n);
export const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + usd.format(Math.abs(n));
export const pct = (n: number, digits = 1) => (Number.isFinite(n) ? (n * 100).toFixed(digits) + '%' : '—');

export const parseDate = (d: string) => new Date(d + 'T00:00:00');
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const monthKey = (d: string) => d.slice(0, 7);
export const monthLabel = (key: string, withYear = false) =>
  parseDate(key + '-01').toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
export const dayLabel = (d: string) =>
  parseDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const dateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

/** Every YYYY-MM between two dates, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const endOfMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return iso(new Date(y, m, 0));
};
