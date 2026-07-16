import { defineConfig } from 'astro/config';

// Public marketing site — igrowfast.com (apex).
// Static output only: every page must exist as real HTML in the response.
// Google's OAuth/Ads-API homepage rules require a public, crawlable page that
// describes the product and is not a login screen — a client-rendered SPA shell
// does not satisfy that, which is why this is a separate build from src/.
export default defineConfig({
  site: 'https://igrowfast.com',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    // Emit /about.html rather than /about/index.html so nginx `try_files` can
    // serve a clean URL without a directory redirect hop.
    format: 'file',
  },
  devToolbar: { enabled: false },
  vite: {
    build: {
      // The demos are hand-written markup + a vanilla engine; there is no
      // framework runtime to split out. Keep chunks whole and small.
      assetsInlineLimit: 2048,
    },
  },
});
