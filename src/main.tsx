import { Buffer } from "buffer";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// @react-pdf/renderer resolves remote <Image /> via fetch + Buffer in the browser bundle
if (typeof (globalThis as unknown as { Buffer?: typeof Buffer }).Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}


createRoot(document.getElementById("root")!).render(<App />);
