import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: "buffer",
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  build: {
    // The status-icon picker (renderReactIcon) loads whole react-icons packs (~5.5 MB) and routes
    // are not yet lazy-split (~4.3 MB app chunk). Both are pre-existing; genuinely shrinking them is a
    // separate optimization (curated icon set / React.lazy routes). Raise the advisory threshold to
    // match today's reality rather than mask it with a risky reactive refactor.
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        // Split heavy, dependency-leaf vendor libs into their own chunks. Shrinks the main
        // bundle under the 500 kB warning and gives react-icons its own chunk (resolving the
        // dynamic+static import warning). React/react-dom intentionally left to default chunking.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-icons")) return "react-icons";
          // NOTE: @react-pdf is deliberately NOT force-chunked. Forcing it into a named
          // manual chunk made Rollup hoist that chunk into the eager entry graph (it was
          // modulepreloaded + fetched on every page, ~1.5 MB) even though every source
          // importer is now behind a dynamic import()/React.lazy boundary. Letting Rollup
          // natural-split it keeps it inside the async (payout/tools) chunks → lazy.
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("framer-motion")) return "framer-motion";
          if (id.includes("node_modules/three") || id.includes("postprocessing")) return "three";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("xlsx")) return "xlsx";
        },
      },
    },
  },
}));
