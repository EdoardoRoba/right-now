/**
 * The bottom marquee. The content is rendered twice so translateX(-50%) loops
 * seamlessly; the second copy is aria-hidden. A plain-text copy goes into a
 * visually hidden paragraph for screen readers.
 */
import { el } from './dom';

export function renderTicker(track: HTMLElement, plain: HTMLElement, segments: string[]): void {
  const group = (hidden: boolean) => {
    const g = el('span', { class: 'ticker__group' });
    if (hidden) g.setAttribute('aria-hidden', 'true');
    // Repeat inside a group so short taglines still fill wide screens.
    for (let r = 0; r < 2; r++) {
      const rep = el('span', { class: 'ticker__rep' });
      for (const s of segments) {
        rep.append(`${s} `, el('span', { class: 'ticker__sep' }, '●'), ' ');
      }
      g.append(rep);
    }
    return g;
  };
  track.replaceChildren(group(false), group(true));
  plain.textContent = segments.join('. ');
}
