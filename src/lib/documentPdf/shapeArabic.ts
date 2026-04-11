import { convertArabic } from 'arabic-reshaper';

const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;

/**
 * Reshapes Arabic text so isolated characters become their joined
 * presentation forms (Unicode Arabic Presentation Forms-B).
 *
 * Does NOT reverse — @react-pdf/renderer handles BiDi ordering
 * when the font is loaded correctly.
 *
 * Non-Arabic text passes through unchanged.
 */
export function shapeArabic(text: string | null | undefined): string {
  if (!text) return '';
  if (!ARABIC_REGEX.test(text)) return text;
  return convertArabic(text);
}
