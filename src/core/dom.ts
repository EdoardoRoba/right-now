/** A tiny `createElement` helper so view code stays readable. */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children);
  return node;
}

/** Opens links to sources in a new tab, safely. */
export function externalLink(href: string, attrs: Attrs = {}, ...children: Child[]) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, ...children);
}
