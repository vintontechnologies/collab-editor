export type ShapeKind = 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text';

// A whiteboard is a shared map of these plain objects, keyed by id.
// Objects are never mutated: every change stores a new copy of the shape.
export interface Shape {
  id: string;
  kind: ShapeKind;
  color: string;
  width: number; // stroke width
  z: number; // drawing order (newer on top)
  // rect / ellipse: the box. arrow: from (x, y) to (x + w, y + h). text: baseline-left at (x, y).
  x: number;
  y: number;
  w: number;
  h: number;
  points?: number[]; // pen: flat list [x0, y0, x1, y1, ...]
  text?: string;
  size?: number; // text: font size
}

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Handle {
  name: string;
  x: number;
  y: number;
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function rectFrom(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

// The box around a shape, used for selection and resizing
export function bounds(s: Shape): Rect {
  if (s.kind === 'pen' && s.points && s.points.length >= 2) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i]);
      maxX = Math.max(maxX, s.points[i]);
      minY = Math.min(minY, s.points[i + 1]);
      maxY = Math.max(maxY, s.points[i + 1]);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (s.kind === 'arrow') return rectFrom({ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h });
  if (s.kind === 'text') {
    const size = s.size ?? 20;
    return {
      x: s.x,
      y: s.y - size,
      w: Math.max(1, s.text?.length ?? 1) * size * 0.6,
      h: size * 1.25,
    };
  }
  return { x: s.x, y: s.y, w: s.w, h: s.h };
}

export function moveShape(s: Shape, dx: number, dy: number): Shape {
  if (s.kind === 'pen' && s.points) {
    return { ...s, points: s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
  }
  return { ...s, x: s.x + dx, y: s.y + dy };
}

// Resize handles: two end points for an arrow, four corners for everything else
export function handlesFor(s: Shape): Handle[] {
  if (s.kind === 'arrow') {
    return [
      { name: 'start', x: s.x, y: s.y },
      { name: 'end', x: s.x + s.w, y: s.y + s.h },
    ];
  }
  const b = bounds(s);
  return [
    { name: 'nw', x: b.x, y: b.y },
    { name: 'ne', x: b.x + b.w, y: b.y },
    { name: 'sw', x: b.x, y: b.y + b.h },
    { name: 'se', x: b.x + b.w, y: b.y + b.h },
  ];
}

// The corner that stays fixed while the opposite one is dragged
export function oppositeCorner(b: Rect, handle: string): Point {
  switch (handle) {
    case 'nw':
      return { x: b.x + b.w, y: b.y + b.h };
    case 'ne':
      return { x: b.x, y: b.y + b.h };
    case 'sw':
      return { x: b.x + b.w, y: b.y };
    case 'se':
      return { x: b.x, y: b.y };
    default:
      return { x: b.x, y: b.y };
  }
}

// Always computed from the shape as it was when the drag began, so there is no drift
export function resizeShape(orig: Shape, handle: string, fixed: Point, p: Point): Shape {
  if (orig.kind === 'arrow') {
    return handle === 'start'
      ? { ...orig, x: p.x, y: p.y, w: orig.x + orig.w - p.x, h: orig.y + orig.h - p.y }
      : { ...orig, w: p.x - orig.x, h: p.y - orig.y };
  }
  const nb = rectFrom(fixed, p);
  if (orig.kind === 'rect' || orig.kind === 'ellipse') return { ...orig, ...nb };

  const b = bounds(orig);
  if (orig.kind === 'pen' && orig.points) {
    const sx = b.w ? nb.w / b.w : 1;
    const sy = b.h ? nb.h / b.h : 1;
    const points = orig.points.map((v, i) =>
      i % 2 === 0 ? nb.x + (v - b.x) * sx : nb.y + (v - b.y) * sy,
    );
    return { ...orig, points };
  }
  // text: scale the font size
  const size = Math.max(8, Math.round((orig.size ?? 20) * (b.h ? nb.h / b.h : 1)));
  return { ...orig, size, x: nb.x, y: nb.y + size };
}

export function sortShapes(list: Shape[]): Shape[] {
  return [...list].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export function readShapes(map: { values(): Iterable<Shape> }): Shape[] {
  return sortShapes(Array.from(map.values()));
}
