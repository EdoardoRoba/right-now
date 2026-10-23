/** The UTC clock in the header. Ticks on the second boundary. */
import { formatUtcClock, systemClock, type Clock } from './time';

export function mountClock(el: HTMLElement, clock: Clock = systemClock): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const now = clock.now();
    el.textContent = formatUtcClock(now);
    el.setAttribute('datetime', new Date(now).toISOString());
    timer = setTimeout(tick, 1000 - (now % 1000) + 5);
  };
  tick();
  return () => clearTimeout(timer);
}
