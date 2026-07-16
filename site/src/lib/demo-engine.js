/* ============================================================
   DEMO ENGINE — ported from announcement-preview.html:2781-2966
   ------------------------------------------------------------
   Ported as-is, deliberately. This engine is battle-tested in the
   in-app announcement deck and it is dependency-free: no React, no
   GSAP, no framer-motion. It stays that way here.

   How it works:
   - Each demo is a fixed-pixel design canvas (.demo-stage, e.g. 960x620)
     uniformly scaled into a fluid frame via transform: scale(). The stage
     NEVER reflows, it only scales — that is what makes a hand-recreated UI
     stay pixel-stable at every viewport.
   - A scene is a plain async function that awaits a Promise-wrapped
     setTimeout between imperative DOM mutations. Motion itself is CSS
     transitions triggered by class toggles; JS only decides when.
   - Cancellation is a token + a rejected promise: every sleep rejects with
     ABORT once ctl.aborted, which unwinds the whole async scene stack at
     the next await.

   THE ONE CHANGE FROM THE DECK:
   the deck starts a demo when a slide becomes active. A marketing page
   scrolls, so playback is driven by an IntersectionObserver — a demo runs
   only while it is actually on screen, and aborts the moment it leaves.
   Offscreen demos must not burn CPU on a long landing page.
   ============================================================ */

export const ABORT = Symbol('abort');

/**
 * The helper kit handed to every scene. Coordinates are DESIGN-SPACE pixels
 * (against the stage's data-w canvas), never screen pixels — the stage is
 * scaled, so screen coords would drift with the viewport.
 *
 * @typedef {object} Engine
 * @property {(ms: number) => Promise<void>} sleep Rejects with ABORT if the scene was cancelled.
 * @property {(x: number, y: number, ms?: number) => Promise<void>} move Glide the cursor.
 * @property {(x: number, y: number, dark?: boolean) => Promise<void>} click Cursor press + ripple. `dark` = light ripple, for dark panels.
 * @property {(elOrSel: string | Element) => { x: number, y: number }} center Design-space centre of an element.
 * @property {(spanEl: Element, text: string, msPerChar?: number) => Promise<void>} typeText
 * @property {HTMLElement} cursor
 * @property {(s: string) => any} q
 * @property {(s: string) => any[]} qa
 */

/**
 * @typedef {object} DemoDef
 * @property {(stage: HTMLElement) => void} [init] Hard-reset the DOM to frame zero. Runs before EVERY replay.
 * @property {(e: Engine, stage: HTMLElement) => Promise<void>} scene The animation itself.
 * @property {(stage: HTMLElement) => void} [staticState] The finished state, rendered instantly. This is what prefers-reduced-motion users get — always provide it.
 */

/** @typedef {{ aborted: boolean }} Ctl */

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------
   makeEngine — per-stage helpers, abortable.
   Verbatim behaviour from the deck: cursor, move, click, center,
   typeText, sleep.
   ------------------------------------------------------------ */
/**
 * @param {HTMLElement} stage
 * @param {Ctl} ctl
 * @returns {Engine}
 */
export function makeEngine(stage, ctl) {
  let cursor = stage.querySelector(':scope > .wd-cursor');
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.className = 'wd-cursor';
    cursor.innerHTML =
      '<svg class="cursor-scale" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 3.2v16.9c0 .45.55.68.87.36l4.1-4.1c.1-.1.23-.15.36-.15h5.85c.46 0 .68-.55.36-.87L6.37 2.85c-.32-.32-.87-.1-.87.35Z" fill="#fff" stroke="#141413" stroke-width="1.3"/></svg>';
    stage.appendChild(cursor);
  }

  // Captured once, before any scale is applied, so center() can convert
  // rendered coordinates back into design-space pixels.
  const designW = parseInt(stage.dataset.w, 10) || stage.offsetWidth;

  const sleep = (ms) =>
    new Promise((res, rej) => {
      if (ctl.aborted) return rej(ABORT);
      setTimeout(() => (ctl.aborted ? rej(ABORT) : res()), ms);
    });

  const move = async (x, y, ms = 700) => {
    cursor.style.transitionDuration = ms + 'ms';
    cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    await sleep(ms + 40);
  };

  const click = async (x, y, dark = false) => {
    cursor.classList.add('is-down');
    const rip = document.createElement('div');
    rip.className = 'wd-ripple' + (dark ? ' dark' : '');
    rip.style.left = x + 4 + 'px';
    rip.style.top = y + 4 + 'px';
    stage.appendChild(rip);
    await sleep(140);
    cursor.classList.remove('is-down');
    setTimeout(() => rip.remove(), 500);
    await sleep(120);
  };

  const center = (elOrSel) => {
    const target =
      typeof elOrSel === 'string' ? stage.querySelector(elOrSel) : elOrSel;
    if (!target) return { x: 0, y: 0 };
    const s = stage.getBoundingClientRect().width / designW;
    const r = target.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    return {
      x: (r.left - st.left + r.width / 2) / s,
      y: (r.top - st.top + r.height / 2) / s,
    };
  };

  const typeText = async (spanEl, text, msPerChar = 26) => {
    const clip = spanEl.closest('.wd-input') || spanEl.parentElement;
    const pill = spanEl.closest('.wd-composer-pill');
    for (let i = 0; i < text.length; i++) {
      spanEl.textContent += text[i];
      if (i === 0 && pill) pill.classList.add('has-text');
      if (clip) clip.scrollLeft = clip.scrollWidth;
      await sleep(text[i] === ' ' ? 13 : msPerChar);
    }
  };

  return {
    sleep,
    move,
    click,
    center,
    typeText,
    cursor,
    q: (s) => stage.querySelector(s),
    qa: (s) => [...stage.querySelectorAll(s)],
  };
}

/* ------------------------------------------------------------
   fit — the core trick. Scale a fixed design canvas into a fluid
   frame. aspectRatio is set from the data attrs so the frame
   reserves correct height before the stage paints.
   ------------------------------------------------------------ */
/** @param {any} frame */
function fit(frame) {
  /** @type {HTMLElement | null} */
  const stage = frame.querySelector('.demo-stage');
  if (!stage) return;
  const w = parseInt(frame.dataset.w, 10);
  const h = parseInt(frame.dataset.h, 10);
  if (!w || !h) return;
  frame.style.aspectRatio = w + ' / ' + h;
  stage.style.transform = 'scale(' + frame.clientWidth / w + ')';
}

/* ------------------------------------------------------------
   registry
   ------------------------------------------------------------ */
/** @type {Map<string, DemoDef>} */
const registry = new Map();

/**
 * Register a demo scene under a key referenced by [data-demo] in markup.
 * @param {string} key
 * @param {DemoDef} def
 */
export function defineDemo(key, def) {
  registry.set(key, def);
}

/* ------------------------------------------------------------
   mountDemos — call once per page.
   Wires scaling (ResizeObserver) + viewport-driven playback
   (IntersectionObserver).
   ------------------------------------------------------------ */
/** @param {Document | HTMLElement} [root] */
export function mountDemos(root = document) {
  /** @type {any[]} */
  const frames = [...root.querySelectorAll('.demo-frame')];
  if (!frames.length) return;

  const ro = new ResizeObserver((entries) =>
    entries.forEach((en) => fit(en.target))
  );
  frames.forEach((f) => {
    fit(f);
    ro.observe(f);
  });

  const reduced = prefersReduced();
  /** @type {WeakMap<any, Ctl>} */
  const controllers = new WeakMap();

  /** @param {any} frame */
  const stop = (frame) => {
    const ctl = controllers.get(frame);
    if (ctl) {
      ctl.aborted = true;
      controllers.delete(frame);
    }
  };

  /** @param {any} frame */
  const start = (frame) => {
    stop(frame);
    /** @type {HTMLElement | null} */
    const stage = frame.querySelector('.demo-stage');
    if (!stage) return;
    const def = registry.get(frame.dataset.demo);
    if (!def) return;

    // Reduced motion: render the finished state, never animate.
    if (reduced) {
      try {
        def.init && def.init(stage);
        def.staticState && def.staticState(stage);
      } catch (err) {
        console.error('[demo ' + frame.dataset.demo + ']', err);
      }
      return;
    }

    const ctl = { aborted: false };
    controllers.set(frame, ctl);

    (async () => {
      const e = makeEngine(stage, ctl);
      try {
        await e.sleep(400);
      } catch (_) {
        return;
      }
      for (;;) {
        if (ctl.aborted) return;
        try {
          def.init && def.init(stage);
          await def.scene(e, stage);
        } catch (err) {
          if (err === ABORT || ctl.aborted) return;
          console.error('[demo ' + frame.dataset.demo + ']', err);
          try {
            await e.sleep(1500);
          } catch (_) {
            return;
          }
        }
      }
    })();
  };

  if (reduced) {
    frames.forEach(start);
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) start(en.target);
        else stop(en.target);
      });
    },
    // Play only when meaningfully on screen; a sliver scrolling past
    // shouldn't kick off a scene the visitor never sees.
    { threshold: 0.35 }
  );
  frames.forEach((f) => io.observe(f));

  // A backgrounded tab throttles timers, which desynchronises a running
  // scene from its CSS transitions. Abort on hide; the observer restarts
  // it cleanly from init() on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) frames.forEach(stop);
    else
      frames.forEach((f) => {
        const r = f.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) start(f);
      });
  });
}
