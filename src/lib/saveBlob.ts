/**
 * Cross-platform blob saver.
 *
 * Designed to give users a predictable "save to device" experience across:
 *   - iOS Safari (ignores `<a download>` for blobs, NEEDS Web Share API)
 *   - Desktop (classic download — Web Share is deliberately skipped even where
 *     the browser supports it; see isMobilePlatform)
 *   - Chrome Android (prefers share sheet, also accepts download)
 *   - Edge / Firefox mobile (mixed behavior, fall through gracefully)
 *
 * Strategy (in order):
 *   1. Web Share API with a File  →  MOBILE ONLY: best for iOS Safari and Android
 *   2. <a download> on a Blob URL →  standard desktop download
 *   3. window.open(blobUrl)       →  last-resort inline viewer
 *
 * The caller always gets back a typed result so it can show the right
 * feedback ("saved to Files", "downloaded", "please use share button",
 * cancelled, or failed).
 */

export type SaveBlobStatus =
    | 'shared'      // Web Share API succeeded (user picked Save to Files, AirDrop, etc.)
    | 'downloaded'  // Classic <a download> fired
    | 'opened'      // Fell back to opening the blob in a new tab
    | 'cancelled'   // User cancelled the share sheet
    | 'unsupported' // No save mechanism available (iframe sandbox, etc.)
    | 'failed';     // An unexpected error happened

export type SaveBlobResult = {
    status: SaveBlobStatus;
    method: 'web-share' | 'anchor-download' | 'window-open' | 'none';
    error?: unknown;
    /** When status is 'unsupported' or 'failed', a blob URL the UI can expose as a last-resort link. */
    url?: string;
    /** Whether Web Share API was attempted at all (for analytics / messaging). */
    tried: { share: boolean; download: boolean; open: boolean };
};

export type SaveBlobOptions = {
    /** Filename (with extension) shown in the save sheet. */
    filename: string;
    /** Title shown in share sheets. Defaults to the filename. */
    title?: string;
    /** Accompanying body text for share sheets. */
    text?: string;
    /** MIME type. Defaults to `blob.type || 'application/octet-stream'`. */
    mimeType?: string;
    /**
     * When true, skip the Web Share API entirely and go straight to
     * classic download. Useful when you've already tried share and
     * want to offer a desktop-style fallback in a "ready" modal.
     */
    preferDownload?: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isIOSSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
        // iPadOS reports as Mac, detect via touch
        (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return isIOS && isSafari;
}

/** Sanitizes a filename for use on iOS / Android / Windows file systems. */
function sanitizeFilename(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'file';
}

function buildFile(blob: Blob, filename: string, mimeType: string): File {
    try {
        return new File([blob], filename, {
            type: mimeType,
            lastModified: Date.now(),
        });
    } catch {
        // Older browsers don't support the File constructor — return a
        // faux-File that still satisfies navigator.canShare's shape checks.
        return Object.assign(blob, { name: filename, lastModified: Date.now() }) as unknown as File;
    }
}

/**
 * Web Share is the RIGHT save path on mobile (iOS Safari cannot download blobs
 * at all) and the WRONG one on desktop, where it interrupts an explicit
 * "download" click with an OS share sheet the user has to dismiss.
 *
 * This used to be implied rather than checked: the strategy note above assumed
 * "desktop → Web Share API missing → classic download". Desktop Chrome/Edge and
 * macOS Safari have since shipped Web Share *with files*, so that assumption
 * silently inverted and desktop users started getting the share sheet. Check the
 * platform explicitly instead of inferring it from feature detection.
 */
function isMobilePlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    if (/Android|iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS reports as MacIntel — the touch-point check is the only reliable tell.
    if (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1) return true;
    return false;
}

function canUseWebShareWithFiles(file: File): boolean {
    if (typeof navigator === 'undefined') return false;
    // Desktop: a click on "download" means download. Never hand it to a share sheet.
    if (!isMobilePlatform()) return false;
    if (typeof (navigator as any).share !== 'function') return false;
    if (typeof (navigator as any).canShare !== 'function') return false;
    try {
        return (navigator as any).canShare({ files: [file] }) === true;
    } catch {
        return false;
    }
}

// ─── Public entry ────────────────────────────────────────────────────────────

export async function saveBlob(blob: Blob, opts: SaveBlobOptions): Promise<SaveBlobResult> {
    const tried = { share: false, download: false, open: false };

    const filename = sanitizeFilename(opts.filename);
    const mimeType = opts.mimeType || blob.type || 'application/octet-stream';
    const file = buildFile(blob, filename, mimeType);

    // ─── 1. Web Share API with files ────────────────────────────────────────
    if (!opts.preferDownload && canUseWebShareWithFiles(file)) {
        tried.share = true;
        try {
            await (navigator as any).share({
                files: [file],
                title: opts.title || filename,
                text: opts.text,
            });
            return { status: 'shared', method: 'web-share', tried };
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                return { status: 'cancelled', method: 'web-share', tried };
            }
            // Share failed for a real reason — fall through. Common cases:
            //   - NotAllowedError (user activation expired on iOS)
            //   - SecurityError  (blocked by permissions policy)
            //   - DataError      (file type not supported)
            console.warn('[saveBlob] share failed, falling back', {
                name: err?.name,
                message: err?.message,
            });
        }
    }

    // ─── 2. Classic <a download> ────────────────────────────────────────────
    // On iOS Safari this historically opens the blob inline instead of
    // downloading, but on every other browser it produces a real download.
    // We still attempt it so desktop users get the expected behaviour.
    const url = URL.createObjectURL(blob);
    tried.download = true;

    try {
        // On iOS Safari, <a download> on blob URLs silently falls back to
        // opening the file. If we already know we're on iOS Safari AND the
        // share API was either unavailable or rejected, we jump straight to
        // opening the URL — at least the user sees the PDF and can tap the
        // Safari share button themselves.
        if (isIOSSafari()) {
            tried.open = true;
            const opened = window.open(url, '_blank');
            if (opened) {
                return { status: 'opened', method: 'window-open', tried, url };
            }
            // Popup blocked — surface the URL so the UI can show a manual link.
            return { status: 'unsupported', method: 'none', tried, url };
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Give the browser a tick to start the download before continuing
        await new Promise((r) => setTimeout(r, 60));

        return { status: 'downloaded', method: 'anchor-download', tried, url };
    } catch (err) {
        // ─── 3. Absolute last resort ──────────────────────────────────────
        tried.open = true;
        try {
            const opened = window.open(url, '_blank');
            if (opened) {
                return { status: 'opened', method: 'window-open', tried, url };
            }
        } catch {
            // ignore
        }
        return { status: 'failed', method: 'none', tried, url, error: err };
    } finally {
        // Keep the URL alive long enough for the browser to start the download
        // or for the user to tap a fallback link. 60 seconds is plenty.
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // ignore
            }
        }, 60_000);
    }
}

/**
 * Convenience: returns true if the current environment is *likely* to give
 * the user a real "save to device" experience. Callers can use this to
 * decide whether to show a "PDF ready" modal (for platforms where a second
 * gesture is required) or just trigger save directly.
 */
export function canDirectSave(): boolean {
    if (typeof navigator === 'undefined') return false;
    // iOS Safari requires the Web Share API path; anything else works with <a download>.
    if (isIOSSafari()) {
        return typeof (navigator as any).canShare === 'function';
    }
    return true;
}
