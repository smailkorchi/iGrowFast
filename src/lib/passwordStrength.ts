/**
 * Dependency-free password strength scoring.
 *
 * Mirrors a strong server-side policy (Supabase GoTrue): the gate (`valid`)
 * requires ≥ 8 chars with lowercase, uppercase and a digit, and rejects a
 * short blocklist of obvious passwords. This is a safe superset of common
 * GoTrue policies, so a password the form accepts will not be bounced back
 * with a 422 at `updateUserById` time.
 *
 * `score` (0–4) drives the visual bar; `valid` drives whether the user can
 * move forward.
 */

/** Minimum length we require regardless of composition. */
export const MIN_PASSWORD_LENGTH = 8;

// Obvious passwords / patterns that pass naive length+class checks but are weak.
const COMMON = new Set([
    'password', 'password1', 'password123', 'passw0rd', 'azerty', 'azerty123',
    'qwerty', 'qwerty123', 'motdepasse', '12345678', '123456789', '1234567890',
    'iloveyou', 'admin123', 'welcome1', 'welcome123', 'letmein', 'abc12345',
    'changeme', 'igrowfast', 'igrowfast1', 'igrowfast123',
]);

export interface PasswordChecks {
    length: boolean;   // ≥ MIN_PASSWORD_LENGTH
    lower: boolean;
    upper: boolean;
    digit: boolean;
    symbol: boolean;
}

export interface PasswordStrength {
    score: 0 | 1 | 2 | 3 | 4; // 0 empty · 1 faible · 2 moyen · 3 fort · 4 très fort
    label: string;
    checks: PasswordChecks;
    /** True once the password meets the minimum acceptable policy. */
    valid: boolean;
}

const LABELS = ['', 'Faible', 'Moyen', 'Fort', 'Très fort'] as const;

export function scorePassword(pw: string): PasswordStrength {
    const checks: PasswordChecks = {
        length: pw.length >= MIN_PASSWORD_LENGTH,
        lower: /[a-z]/.test(pw),
        upper: /[A-Z]/.test(pw),
        digit: /\d/.test(pw),
        symbol: /[^A-Za-z0-9]/.test(pw),
    };

    if (!pw) return { score: 0, label: '', checks, valid: false };

    const isCommon = COMMON.has(pw.toLowerCase());
    // Core policy: length + the three base classes, not a known-common password.
    const valid = checks.length && checks.lower && checks.upper && checks.digit && !isCommon;

    if (isCommon) return { score: 1, label: LABELS[1], checks, valid: false };

    const classes = [checks.lower, checks.upper, checks.digit, checks.symbol].filter(Boolean).length;
    let raw = 0;
    if (pw.length >= 6) raw++;
    if (pw.length >= MIN_PASSWORD_LENGTH) raw++;
    if (pw.length >= 12) raw++;
    if (classes >= 2) raw++;
    if (classes >= 3) raw++;
    if (classes >= 4) raw++;

    // Map raw (0–6) to a 1–4 band; a password can never read above "Faible"
    // until it actually clears the policy gate.
    let score: PasswordStrength['score'];
    if (raw <= 2) score = 1;
    else if (raw <= 3) score = 2;
    else if (raw <= 5) score = 3;
    else score = 4;
    if (!valid && score > 1) score = 1;

    return { score, label: LABELS[score], checks, valid };
}
