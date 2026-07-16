/* ============================================================
   Consent gate
   ------------------------------------------------------------
   Self-hosted on purpose. A third-party CMP would itself be another
   processor to disclose, on a site whose whole job includes passing
   privacy review.

   Why this exists at all: the owner chose the full ad stack (Meta,
   TikTok, Snap, GA) on the apex. Running a retargeting pixel for an
   EU visitor is "monitoring of behaviour" under GDPR Art 3(2)(b),
   which pulls this company into GDPR. That decision is made; this
   file is the machinery it obligates.

   The rules encoded here, each non-negotiable:
   - NOTHING fires before consent. Default is denied, always.
   - Granular per purpose. No all-or-nothing bundle.
   - Reject is exactly as easy as accept — same level, same weight,
     same number of clicks. A styled-down reject is a finding.
   - Withdrawal is as easy as consent (the footer's persistent
     "Cookie settings" control reopens this).
   - The banner NEVER blocks content or the crawler. Google must be
     able to read the homepage it is verifying, and legal pages must
     be readable without interacting.
   ============================================================ */

const STORE_KEY = 'igf.consent.v1';

/** Bump when the purposes below change — invalidates prior consent, as it must. */
const POLICY_VERSION = 1;

export const PURPOSES = {
  necessary: {
    label: 'Strictly necessary',
    description:
      'Required for the site to work. Never used for tracking. Cannot be switched off.',
    required: true,
  },
  analytics: {
    label: 'Analytics',
    description: 'Helps us understand which pages are useful. Aggregate only.',
    required: false,
  },
  marketing: {
    label: 'Marketing',
    description:
      'Lets us measure our advertising and show relevant ads on other platforms.',
    required: false,
  },
};

const DENIED = { necessary: true, analytics: false, marketing: false };

export function readConsent() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== POLICY_VERSION) return null; // re-ask on policy change
    return parsed.purposes;
  } catch {
    return null; // private mode / disabled storage → treat as no consent
  }
}

function writeConsent(purposes) {
  const record = {
    version: POLICY_VERSION,
    at: new Date().toISOString(),
    purposes: { ...purposes, necessary: true },
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable — consent simply won't persist; nothing fires */
  }
  applyConsent(record.purposes);
  window.dispatchEvent(
    new CustomEvent('igf:consent', { detail: record.purposes })
  );
}

/* ------------------------------------------------------------
   Google Consent Mode v2.
   Must be initialised to DENIED before gtag loads, not after — the
   whole point is that the default state is already denied when any
   Google tag arrives.
   ------------------------------------------------------------ */
function gtag() {
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}

export function initConsentMode() {
  window.dataLayer = window.dataLayer || [];
  const c = readConsent() || DENIED;
  gtag('consent', 'default', {
    ad_storage: c.marketing ? 'granted' : 'denied',
    ad_user_data: c.marketing ? 'granted' : 'denied',
    ad_personalization: c.marketing ? 'granted' : 'denied',
    analytics_storage: c.analytics ? 'granted' : 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500,
  });
}

function updateConsentMode(c) {
  gtag('consent', 'update', {
    ad_storage: c.marketing ? 'granted' : 'denied',
    ad_user_data: c.marketing ? 'granted' : 'denied',
    ad_personalization: c.marketing ? 'granted' : 'denied',
    analytics_storage: c.analytics ? 'granted' : 'denied',
  });
}

/* ------------------------------------------------------------
   Tag loading.

   ⚠ NOT YET WIRED — pixel/measurement IDs are not provisioned.
   Every id below is intentionally empty, so nothing loads. This is
   the correct state for a site that is published but not yet driving
   traffic: the machinery is built and gated, and the moment a real id
   is dropped in, it works and is already consent-gated.

   Do NOT hardcode ids here without also adding each destination to
   /privacy as a named recipient, and note that Meta Pixel makes
   iGrowFast a JOINT CONTROLLER with Meta (CJEU Fashion ID, C-40/17),
   which needs an Art 26 arrangement — not a processor line.
   ------------------------------------------------------------ */
const TAGS = {
  ga4: '', // e.g. 'G-XXXXXXX'
  metaPixel: '', // e.g. '1234567890'
  tiktok: '', // e.g. 'CXXXXXXXXXXXXXXXXXXX'
  snap: '', // e.g. 'xxxxxxxx-xxxx-xxxx'
};

const loaded = new Set();

function injectScript(src, attrs = {}) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
  document.head.appendChild(s);
  return s;
}

function applyConsent(c) {
  updateConsentMode(c);

  if (c.analytics && TAGS.ga4 && !loaded.has('ga4')) {
    loaded.add('ga4');
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${TAGS.ga4}`);
    gtag('js', new Date());
    gtag('config', TAGS.ga4, { anonymize_ip: true });
  }

  if (c.marketing) {
    // Meta / TikTok / Snap loaders go here, each guarded by its id and
    // the `loaded` set. Left unwired deliberately — see TAGS above.
  }

  // Note: consent withdrawal cannot unring a bell. A tag already loaded
  // in this document stays loaded; Consent Mode stops it transmitting, and
  // the next navigation won't load it at all. That is the standard,
  // defensible behaviour — but it is why nothing may load pre-consent.
}

/* ------------------------------------------------------------
   Banner UI
   ------------------------------------------------------------ */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  });
  kids.flat().forEach((kid) =>
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid)
  );
  return el;
}

function buildBanner(onDone, initial) {
  const state = { ...(initial || DENIED) };

  const root = h('div', {
    class: 'igf-cookie',
    role: 'dialog',
    'aria-modal': 'false', // NOT modal — it must never trap or block content
    'aria-label': 'Cookie preferences',
  });

  const detail = h('div', { class: 'cc-detail', hidden: 'until-found' });
  Object.entries(PURPOSES).forEach(([key, p]) => {
    const input = h('input', {
      type: 'checkbox',
      id: `cc-${key}`,
      ...(p.required ? { checked: 'checked', disabled: 'disabled' } : {}),
      ...(state[key] && !p.required ? { checked: 'checked' } : {}),
    });
    input.addEventListener('change', () => {
      state[key] = input.checked;
    });
    detail.appendChild(
      h(
        'div',
        { class: 'cc-purpose' },
        input,
        h(
          'label',
          { for: `cc-${key}` },
          h('strong', {}, p.label),
          h('span', {}, p.description)
        )
      )
    );
  });

  const close = (purposes) => {
    writeConsent(purposes);
    root.remove();
    onDone && onDone(purposes);
  };

  const actions = h(
    'div',
    { class: 'cc-actions' },
    // Reject and Accept are siblings, same element, same class, same weight.
    // Any visual asymmetry here is a compliance finding, not a style choice.
    h('button', { type: 'button', class: 'cc-btn', onClick: () => close(DENIED) }, 'Reject all'),
    h(
      'button',
      {
        type: 'button',
        class: 'cc-btn',
        onClick: () => close({ necessary: true, analytics: true, marketing: true }),
      },
      'Accept all'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'cc-btn cc-btn-ghost',
        onClick: (e) => {
          const open = detail.hasAttribute('hidden');
          if (open) detail.removeAttribute('hidden');
          else detail.setAttribute('hidden', 'until-found');
          e.currentTarget.textContent = open ? 'Hide options' : 'Options';
        },
      },
      'Options'
    ),
    h('button', { type: 'button', class: 'cc-btn cc-btn-ghost', onClick: () => close(state) }, 'Save choices')
  );

  root.appendChild(
    h(
      'p',
      { class: 'cc-copy' },
      'We use cookies to run this site, and — with your permission — to measure our advertising. You can change this at any time. ',
      h('a', { href: '/cookies' }, 'Cookie Policy')
    )
  );
  root.appendChild(detail);
  root.appendChild(actions);
  return root;
}

/* ------------------------------------------------------------
   mount
   ------------------------------------------------------------ */
export function mountConsent() {
  initConsentMode();

  const existing = readConsent();
  if (existing) applyConsent(existing);

  const show = () => {
    if (document.querySelector('.igf-cookie')) return;
    document.body.appendChild(buildBanner(null, readConsent() || DENIED));
  };

  // The persistent withdrawal control (footer). Withdrawal must be as easy
  // as consent — this is that guarantee.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-cookie-settings]');
    if (!t) return;
    e.preventDefault();
    show();
  });

  // First visit only. Never shown to a visitor who already chose — and
  // never blocking either way.
  if (!existing) show();
}
