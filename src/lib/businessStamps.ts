import { supabase } from '@/lib/supabase';

// #44 (owner-decided 2026-07-17): cachet + signature live in the PRIVATE
// 'business-stamps' bucket (plain logos stay public in 'business-logos').
// Stored values may be a bare storage path (new writes), a legacy public
// business-logos URL (old rows + frozen doc snapshots), or a data: URI
// (already-embedded snapshots). resolveStampUrl turns any of them into a
// fetchable URL via a short-lived signed URL; it FAILS OPEN to the original
// https value so nothing breaks if signing is ever unavailable.
const STAMPS_BUCKET = 'business-stamps';
const SIGNED_TTL_S = 60 * 60;

/** Storage path behind a stored stamp value, or null when there is none. */
export function stampStoragePath(value: string | null | undefined): string | null {
  const v = (value || '').trim();
  if (!v || v.startsWith('data:')) return null;
  if (!/^https?:\/\//i.test(v)) return v.replace(/^\/+/, '') || null;
  const m = v.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/(?:business-logos|business-stamps)\/(.+?)(?:\?.*)?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Resolve a stored cachet/signature value to something fetchable/renderable. */
export async function resolveStampUrl(value: string | null | undefined): Promise<string | null> {
  const v = (value || '').trim();
  if (!v) return null;
  if (v.startsWith('data:')) return v;
  const path = stampStoragePath(v);
  if (!path) return /^https?:\/\//i.test(v) ? v : null;
  const { data, error } = await supabase.storage.from(STAMPS_BUCKET).createSignedUrl(path, SIGNED_TTL_S);
  if (error || !data?.signedUrl) return /^https?:\/\//i.test(v) ? v : null;
  return data.signedUrl;
}

/** Resolve both stamp fields on a loaded business shape in one go. */
export async function resolveStamps<T extends { cachet_url?: string | null; signature_url?: string | null }>(
  row: T,
): Promise<T> {
  const [cachet, signature] = await Promise.all([
    resolveStampUrl(row.cachet_url),
    resolveStampUrl(row.signature_url),
  ]);
  return { ...row, cachet_url: cachet, signature_url: signature };
}
