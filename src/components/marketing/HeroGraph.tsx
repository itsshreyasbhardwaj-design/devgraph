'use client';

import * as React from 'react';

/**
 * The hero graph.
 *
 * A real layered dependency graph of an example storefront repository, drawn
 * with the same visual grammar the product uses: a language-coloured rail on
 * every node, hairline edges, and the one cycle picked out in coral. Edges draw
 * themselves in layer order on load, so the page opens with the exact motion of
 * an analysis resolving.
 *
 * Positions are authored rather than force-simulated: this is a hero, and a
 * deterministic layout renders identically on every load and every device. The
 * entrance is CSS rather than JS so a throttled animation frame loop leaves the
 * graph fully drawn instead of blank.
 */

interface HeroNode {
  id: string;
  label: string;
  x: number;
  y: number;
  lang: 'ts' | 'tsx' | 'sql';
  entry?: boolean;
  cycle?: boolean;
}

interface HeroEdge {
  from: string;
  to: string;
  cycle?: boolean;
}

const LANG_COLOR: Record<HeroNode['lang'], string> = {
  ts: 'var(--color-signal)',
  tsx: 'var(--color-edge)',
  sql: 'var(--color-stable)',
};

const NODE_W = 136;
const NODE_H = 30;

const NODES: HeroNode[] = [
  { id: 'layout', label: 'app/layout.tsx', x: 14, y: 34, lang: 'tsx', entry: true },
  { id: 'page', label: 'app/page.tsx', x: 14, y: 92, lang: 'tsx', entry: true },
  { id: 'route', label: 'orders/route.ts', x: 14, y: 214, lang: 'ts', entry: true },

  { id: 'header', label: 'Header.tsx', x: 218, y: 20, lang: 'tsx' },
  { id: 'list', label: 'ProductList.tsx', x: 218, y: 78, lang: 'tsx' },
  { id: 'card', label: 'ProductCard.tsx', x: 218, y: 136, lang: 'tsx' },

  { id: 'hooks', label: 'useProducts.ts', x: 422, y: 78, lang: 'ts' },
  { id: 'orders', label: 'orderService.ts', x: 422, y: 190, lang: 'ts', cycle: true },
  { id: 'users', label: 'userService.ts', x: 422, y: 254, lang: 'ts', cycle: true },

  { id: 'format', label: 'lib/format.ts', x: 618, y: 140, lang: 'ts' },
  { id: 'db', label: 'lib/db.ts', x: 618, y: 214, lang: 'ts' },
  { id: 'schema', label: 'schema.prisma', x: 618, y: 288, lang: 'sql' },
];

const EDGES: HeroEdge[] = [
  { from: 'layout', to: 'header' },
  { from: 'page', to: 'header' },
  { from: 'page', to: 'list' },
  { from: 'list', to: 'card' },
  { from: 'list', to: 'hooks' },
  { from: 'route', to: 'orders' },
  { from: 'route', to: 'users' },
  { from: 'orders', to: 'users', cycle: true },
  { from: 'users', to: 'orders', cycle: true },
  { from: 'orders', to: 'format' },
  { from: 'orders', to: 'db' },
  { from: 'users', to: 'db' },
  { from: 'db', to: 'schema' },
];

const BY_ID = new Map(NODES.map((node) => [node.id, node]));

/** Horizontal cubic between right-edge and left-edge anchors. */
function edgePath(from: HeroNode, to: HeroNode, offset = 0): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2 + offset;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2 + offset;
  const dx = Math.max(26, (x2 - x1) * 0.55);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export function HeroGraph({ className }: { className?: string }) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  const related = React.useMemo(() => {
    if (!hovered) return null;
    const ids = new Set<string>([hovered]);
    for (const edge of EDGES) {
      if (edge.from === hovered) ids.add(edge.to);
      if (edge.to === hovered) ids.add(edge.from);
    }
    return ids;
  }, [hovered]);

  // Opacity is only set inline while something is hovered, so it never fights
  // the entrance animation.
  const nodeOpacity = (id: string) => (related && !related.has(id) ? 0.2 : undefined);
  const edgeOpacity = (edge: HeroEdge) =>
    related && !(related.has(edge.from) && related.has(edge.to)) ? 0.1 : undefined;

  return (
    <svg
      viewBox="0 0 790 348"
      className={className}
      role="img"
      aria-label="Dependency graph of an example storefront repository, with one circular dependency highlighted in red"
      onMouseLeave={() => setHovered(null)}
    >
      <defs>
        <marker
          id="hero-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--color-line-strong)" />
        </marker>
        <marker
          id="hero-arrow-cycle"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--color-cycle)" />
        </marker>
      </defs>

      <g fill="none">
        {EDGES.map((edge, index) => {
          const from = BY_ID.get(edge.from);
          const to = BY_ID.get(edge.to);
          if (!from || !to) return null;
          // The two halves of the cycle are offset so both stay readable.
          const offset = edge.cycle ? (edge.from === 'orders' ? -5 : 5) : 0;
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              className={edge.cycle ? 'hero-edge-cycle' : 'hero-edge'}
              d={edgePath(from, to, offset)}
              stroke={edge.cycle ? 'var(--color-cycle)' : 'var(--color-line-strong)'}
              strokeWidth={edge.cycle ? 1.4 : 1}
              strokeDasharray={edge.cycle ? '3 3' : undefined}
              markerEnd={edge.cycle ? 'url(#hero-arrow-cycle)' : 'url(#hero-arrow)'}
              opacity={edgeOpacity(edge)}
              style={{
                animationDelay: `${0.34 + index * 0.05}s`,
                transition: 'opacity 180ms ease',
              }}
            />
          );
        })}
      </g>

      {NODES.map((node, index) => (
        <g
          key={node.id}
          className="hero-node"
          opacity={nodeOpacity(node.id)}
          style={{
            animationDelay: `${0.08 + index * 0.045}s`,
            transition: 'opacity 180ms ease',
            cursor: 'pointer',
          }}
          onMouseEnter={() => setHovered(node.id)}
        >
          <rect
            x={node.x}
            y={node.y}
            width={NODE_W}
            height={NODE_H}
            rx={5}
            fill="rgba(22, 22, 31, 0.94)"
            stroke={
              node.cycle
                ? 'var(--color-cycle)'
                : hovered === node.id
                  ? 'var(--color-edge)'
                  : 'var(--color-line)'
            }
            strokeWidth={node.cycle || hovered === node.id ? 1.25 : 1}
          />
          {/* Language rail — the same device the product uses on every node. */}
          <rect
            x={node.x + 1.5}
            y={node.y + 1.5}
            width={2.5}
            height={NODE_H - 3}
            rx={1.25}
            fill={LANG_COLOR[node.lang]}
          />
          {node.entry ? (
            <circle
              cx={node.x + NODE_W - 11}
              cy={node.y + NODE_H / 2}
              r={2.5}
              fill="var(--color-stable)"
            />
          ) : null}
          <text
            x={node.x + 13}
            y={node.y + NODE_H / 2 + 3.5}
            fontSize={10.5}
            fontFamily="var(--font-mono)"
            fill={hovered === node.id ? 'var(--color-ink)' : 'var(--color-ink-muted)'}
          >
            {node.label}
          </text>
        </g>
      ))}

      {/* The annotation that names what the coral edges mean. */}
      <g
        className="hero-annotation"
        style={{ animationDelay: '1.3s', transition: 'opacity 180ms ease' }}
        opacity={related ? 0.2 : undefined}
      >
        <path
          d="M 420 300 L 384 322 L 322 322"
          stroke="var(--color-cycle)"
          strokeWidth={1}
          fill="none"
          opacity={0.55}
        />
        <text
          x={316}
          y={325}
          textAnchor="end"
          fontSize={9.5}
          fontFamily="var(--font-mono)"
          fill="var(--color-cycle)"
          letterSpacing="0.08em"
        >
          CIRCULAR DEPENDENCY
        </text>
      </g>
    </svg>
  );
}
