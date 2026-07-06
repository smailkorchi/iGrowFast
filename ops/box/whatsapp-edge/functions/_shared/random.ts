// Cryptographic randomness helpers for edge functions (Deno).

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** URL-safe random token, default 48 chars (~240 bits of entropy). */
export function randomToken(chars = 48): string {
  const bytes = new Uint8Array(chars)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += BASE32_ALPHABET[b % BASE32_ALPHABET.length]
  return out
}

/** Slugify display name + append random suffix for a unique evolution_instance_name. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    || 'instance'
}
