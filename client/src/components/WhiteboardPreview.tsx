import { bounds } from '../data/shapes';
import type { Shape } from '../data/shapes';
import ShapeView from './ShapeView';

// Read-only picture of an old version, zoomed to fit all its shapes
export default function WhiteboardPreview({ shapes }: { shapes: Shape[] }) {
  if (shapes.length === 0) {
    return <div className="board-wrap board-empty">This version is empty.</div>;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = bounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const pad = 40;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  return (
    <div className="board-wrap">
      <svg className="board" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
        {shapes.map((s) => (
          <ShapeView key={s.id} shape={s} />
        ))}
      </svg>
    </div>
  );
}
