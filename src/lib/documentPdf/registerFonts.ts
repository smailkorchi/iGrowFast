import { Font } from '@react-pdf/renderer';

let registered = false;
let fontsReady: Promise<void> | null = null;

function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function doRegister() {
  const [regularBuf, boldBuf] = await Promise.all([
    fetch('/fonts/NotoSansArabic-Regular.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/NotoSansArabic-Bold.ttf').then((r) => r.arrayBuffer()),
  ]);

  Font.register({
    family: 'NotoSansArabic',
    fonts: [
      { src: arrayBufferToDataUrl(regularBuf, 'font/truetype'), fontWeight: 'normal' as const },
      { src: arrayBufferToDataUrl(boldBuf, 'font/truetype'), fontWeight: 'bold' as const },
    ],
  });

  Font.registerHyphenationCallback((word) => [word]);
}

export function registerPdfFonts(): Promise<void> {
  if (registered) return Promise.resolve();
  if (!fontsReady) {
    fontsReady = doRegister().then(() => { registered = true; });
  }
  return fontsReady;
}
