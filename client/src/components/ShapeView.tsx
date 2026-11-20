import type { Shape } from '../data/shapes';

// Draws one shape as SVG. Pens and arrows get an invisible, wider copy so they are easy to click.
export default function ShapeView({ shape: s }: { shape: Shape }) {
  const line = {
    stroke: s.color,
    strokeWidth: s.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const hit = Math.max(s.width, 14);

  switch (s.kind) {
    case 'pen': {
      const pts = (s.points ?? []).map((v, i) => (i % 2 === 0 ? `${v},` : `${v} `)).join('');
      return (
        <g data-shape={s.id}>
          <polyline points={pts} fill="none" stroke="transparent" strokeWidth={hit} />
          <polyline points={pts} fill="none" {...line} />
        </g>
      );
    }
    case 'rect':
      return (
        <rect
          data-shape={s.id}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill="transparent"
          {...line}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          data-shape={s.id}
          cx={s.x + s.w / 2}
          cy={s.y + s.h / 2}
          rx={s.w / 2}
          ry={s.h / 2}
          fill="transparent"
          {...line}
        />
      );
    case 'arrow': {
      const x2 = s.x + s.w;
      const y2 = s.y + s.h;
      const angle = Math.atan2(s.h, s.w);
      const head = 10 + s.width * 2;
      const a = `${x2 - head * Math.cos(angle - Math.PI / 6)},${y2 - head * Math.sin(angle - Math.PI / 6)}`;
      const b = `${x2 - head * Math.cos(angle + Math.PI / 6)},${y2 - head * Math.sin(angle + Math.PI / 6)}`;
      return (
        <g data-shape={s.id}>
          <line x1={s.x} y1={s.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={hit} />
          <line x1={s.x} y1={s.y} x2={x2} y2={y2} {...line} />
          <polygon
            points={`${x2},${y2} ${a} ${b}`}
            fill={s.color}
            stroke={s.color}
            strokeLinejoin="round"
          />
        </g>
      );
    }
    case 'text':
      return (
        <text
          data-shape={s.id}
          x={s.x}
          y={s.y}
          fontSize={s.size ?? 20}
          fill={s.color}
          fontFamily="system-ui, sans-serif"
          style={{ userSelect: 'none' }}
        >
          {s.text}
        </text>
      );
  }
}
