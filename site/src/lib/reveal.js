/* ============================================================
   Scroll reveals
   ------------------------------------------------------------
   Deliberately restrained. The brand register warns that one identical
   entrance applied to every section is the AI reflex — the tell isn't
   motion, it's the uniformity. So this is opt-in per element via
   [data-reveal], not a blanket sweep of every <section>.

   Two hard rules baked in:

   1. REVEALS ENHANCE AN ALREADY-VISIBLE DEFAULT. Content is NOT hidden in
      CSS waiting for a class. Transitions pause on hidden tabs and never
      fire in headless renderers — gate visibility on JS and the section
      ships blank to a crawler. So the initial hidden state is applied by
      JS, at runtime, only once we know we're in a real browser that will
      actually run the animation.

   2. prefers-reduced-motion gets nothing applied at all. Not a faster
      version — nothing. The page is simply already correct.
   ============================================================ */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function mountReveals(root = document) {
  const targets = [...root.querySelectorAll('[data-reveal]')];
  if (!targets.length) return;

  const mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    // Hidden state is set HERE, in JS, not in the stylesheet. A crawler or a
    // reduced-motion visitor never reaches this line, so they never see a
    // hidden section.
    gsap.set(targets, { opacity: 0, y: 24 });

    ScrollTrigger.batch(targets, {
      start: 'top 85%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.12,
          overwrite: true,
        }),
    });

    // matchMedia reverts anything created in here when the query stops
    // matching, so a visitor toggling reduced-motion mid-session gets the
    // content back rather than a permanently invisible page.
    return () => gsap.set(targets, { clearProps: 'opacity,transform' });
  });
}
