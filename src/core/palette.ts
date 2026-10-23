/**
 * Colour tokens needed in TypeScript (canvas drawing, event colours).
 * Mirrors src/styles/tokens.css — keep the two in sync.
 */
export const palette = {
  bg: '#07080C',
  line: '#1A1E29',
  text: '#E9ECF2',
  muted: '#9AA3B5',
  faint: '#8A93A6',
  dim: '#3B4763',
  small: '#7FA8FF',
  mid: '#FFB547',
  strong: '#FF7A45',
} as const;

export const fonts = {
  display: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;
