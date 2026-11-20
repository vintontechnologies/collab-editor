// Each user gets a stable color, used for their cursor and selection
const PALETTE = [
  '#e03131',
  '#1971c2',
  '#2f9e44',
  '#f08c00',
  '#9c36b5',
  '#0c8599',
  '#d6336c',
  '#5f3dc4',
];

export function userColor(id: number) {
  const color = PALETTE[id % PALETTE.length];
  return { color, light: `${color}33` }; // light = same color at 20% opacity (hex alpha)
}
