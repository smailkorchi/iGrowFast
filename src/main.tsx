import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// Brand fonts self-hosted via @fontsource (T18) — replaces the Google Fonts CDN links.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/500.css";
import "@fontsource/lora/600.css";
import "./index.css";

// @react-pdf/renderer resolves remote <Image /> via fetch + Buffer in the browser bundle
if (typeof (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}


createRoot(document.getElementById("root")!).render(<App />);
