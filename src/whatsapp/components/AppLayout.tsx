// IGF SHELL SHIM — replaces WA Mancer's components/AppLayout.tsx.
//
// The WA app shell (sidebar, nav, org presence pill) is NOT ported — the inbox
// mounts inside iGrowFast's own AppLayout. The only contract WA route files
// consume from this module is useSidebarCollapse(): Conversations.tsx calls it
// once on mount to collapse WA's sidebar for maximum inbox width. IGF's admin
// sidebar manages its own state, so this is a stable no-op.
const noop = () => {}

export function useSidebarCollapse() {
  return noop
}
