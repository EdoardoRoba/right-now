/** prefers-reduced-motion, as a live value. */

const query =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function prefersReducedMotion(): boolean {
  return query?.matches ?? false;
}

export function onReducedMotionChange(fn: (reduced: boolean) => void): () => void {
  if (!query) return () => {};
  const handler = (e: MediaQueryListEvent) => fn(e.matches);
  query.addEventListener('change', handler);
  return () => query.removeEventListener('change', handler);
}
