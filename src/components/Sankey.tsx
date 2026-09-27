import { useEffect, useMemo, useRef, useState } from 'react';
import { sankey, sankeyJustify, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import type { Item } from '../lib/finance';
import { money, pct } from '../lib/format';
import { INCOME_COLOR, SAVINGS_COLOR } from '../lib/model';

export type SankeyMode = 'groups' | 'categories' | 'both';

type N = { id: string; label: string; color: string; side: 'left' | 'center' | 'right' | 'mid'; value?: number };
type L = { source: string; target: string; value: number; color: string };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function CashFlowSankey({ income, expenses, totalIncome, mode, onSelect }: { income: Item[]; expenses: Item[]; totalIncome: number; mode: SankeyMode; onSelect?: (key: string) => void }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);

  const graph = useMemo(() => {
    const nodes: N[] = [];
    const links: L[] = [];
    const pos = income.filter((i) => i.amount > 0);
    const spend = expenses.filter((e) => e.amount > 0);
    const totalSpend = spend.reduce((s, e) => s + e.amount, 0);
    const inflow = pos.reduce((s, i) => s + i.amount, 0);
    nodes.push({ id: 'income', label: 'Income', color: INCOME_COLOR, side: 'center' });
    for (const i of pos) {
      nodes.push({ id: 'in:' + i.key, label: i.label, color: i.kind === 'property' ? i.color : INCOME_COLOR, side: 'left' });
      links.push({ source: 'in:' + i.key, target: 'income', value: i.amount, color: i.kind === 'property' ? i.color : INCOME_COLOR });
    }
    if (totalSpend > inflow) {
      nodes.push({ id: 'in:deficit', label: 'From savings', color: '#a8a29e', side: 'left' });
      links.push({ source: 'in:deficit', target: 'income', value: totalSpend - inflow, color: '#a8a29e' });
    }
    if (inflow > totalSpend) {
      nodes.push({ id: 'savings', label: 'Savings', color: SAVINGS_COLOR, side: 'right' });
      links.push({ source: 'income', target: 'savings', value: inflow - totalSpend, color: SAVINGS_COLOR });
    }
    const leaf = (it: Item, parent: string) => {
      nodes.push({ id: 'out:' + it.key, label: it.label, color: it.color, side: 'right' });
      links.push({ source: parent, target: 'out:' + it.key, value: it.amount, color: it.color });
    };
    for (const g of spend) {
      const kids = (g.children ?? []).filter((c) => c.amount > 0);
      if (mode === 'groups' || !kids.length) leaf(g, 'income');
      else if (mode === 'categories') kids.forEach((c) => leaf(c, 'income'));
      else {
        nodes.push({ id: 'grp:' + g.key, label: g.label, color: g.color, side: 'mid' });
        links.push({ source: 'income', target: 'grp:' + g.key, value: kids.reduce((s, c) => s + c.amount, 0), color: g.color });
        kids.forEach((c) => leaf(c, 'grp:' + g.key));
      }
    }
    return { nodes, links, rightCount: nodes.filter((n) => n.side === 'right').length, leftCount: nodes.filter((n) => n.side === 'left').length };
  }, [income, expenses, mode]);

  const compact = width < 560;
  const height = Math.max(340, Math.max(graph.rightCount, graph.leftCount) * (compact ? 34 : 40));
  const margin = { left: compact ? 92 : 150, right: compact ? 104 : 170, top: 28, bottom: 8 };

  const layout = useMemo(() => {
    if (!graph.links.length) return null;
    const gen = sankey<N, L>()
      .nodeId((n) => n.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(10)
      .nodePadding(compact ? 20 : 24)
      .nodeSort(null)
      .extent([
        [margin.left, margin.top],
        [Math.max(margin.left + 60, width - margin.right), height - margin.bottom],
      ]);
    return gen({ nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links.map((l) => ({ ...l })) });
  }, [graph, width, height, compact, margin.left, margin.right, margin.top, margin.bottom]);

  if (!layout) return <div ref={ref} className="muted empty">No income or spending in this period.</div>;
  const path = sankeyLinkHorizontal<N, L>();

  // Nudge labels apart so two-line labels on small nodes never overlap.
  const labelY = new Map<string, number>();
  const LABEL_H = 27;
  for (const side of ['left', 'right', 'mid'] as const) {
    const col = layout.nodes.filter((n) => n.side === side).sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0));
    let last = -Infinity;
    for (const n of col) {
      const y = Math.max(((n.y0 ?? 0) + (n.y1 ?? 0)) / 2 - 2, last + LABEL_H);
      labelY.set(n.id, y);
      last = y;
    }
  }
  const svgHeight = Math.max(height, ...[...labelY.values()].map((y) => y + LABEL_H));

  return (
    <div ref={ref} className="sankey-wrap" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={svgHeight} role="img" aria-label="Cash flow diagram">
        <g>
          {layout.links.map((l, i) => {
            const s = l.source as SankeyNode<N, L>;
            const t = l.target as SankeyNode<N, L>;
            return (
              <path
                key={i}
                d={path(l as SankeyLink<N, L>) ?? ''}
                fill="none"
                stroke={l.color}
                strokeOpacity={0.28}
                strokeWidth={Math.max(1.5, l.width ?? 1)}
                className="sankey-link"
                onMouseMove={(e) => {
                  const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({ x: e.clientX - box.left, y: e.clientY - box.top, text: `${s.label} → ${t.label}: ${money(l.value)} (${pct(l.value / totalIncome)})` });
                }}
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((n) => {
            const x0 = n.x0 ?? 0;
            const x1 = n.x1 ?? 0;
            const y0 = n.y0 ?? 0;
            const y1 = n.y1 ?? 0;
            const h = Math.max(2, y1 - y0);
            const cy = (y0 + y1) / 2;
            const value = n.value ?? 0;
            const anchor = n.side === 'left' ? 'end' : n.side === 'center' ? 'middle' : 'start';
            const tx = n.side === 'left' ? x0 - 8 : n.side === 'center' ? (x0 + x1) / 2 : x1 + 8;
            const ty = n.side === 'center' ? y0 - 18 : labelY.get(n.id) ?? cy - 2;
            const key = n.id.replace(/^(out|grp|in):/, '');
            return (
              <g key={n.id} className={onSelect && n.side !== 'center' ? 'clickable' : ''} onClick={() => n.side !== 'center' && onSelect?.(key)}>
                <rect x={x0} y={y0} width={x1 - x0} height={h} rx={2} fill={n.color} />
                {(
                  <text x={tx} y={ty} textAnchor={anchor} className="sankey-label">
                    <tspan className="sankey-name">{n.label}</tspan>
                    <tspan x={tx} dy="1.2em" className="sankey-value">
                      {money(value)}
                      {!compact && n.side !== 'center' ? ` (${pct(value / totalIncome)})` : ''}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {hover && (
        <div className="tooltip floating" style={{ left: Math.min(hover.x + 12, width - 220), top: hover.y + 12 }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}
