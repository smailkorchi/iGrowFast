/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    BrowserQRCodeReader,
    type IScannerControls,
} from '@zxing/browser';
import { Camera, CameraOff, X, Flashlight, Loader2, ScanLine } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── QR payload validation ───────────────────────────────────────────────────
// The courier label generator embeds the short tracking code as QR content
// (e.g. `CR-AB12CD34`). We accept any tracking code that starts with `CR-`
// and has 6–16 chars of alnum after — forgiving of future changes, strict
// enough to reject unrelated scans (URLs, vCards, WiFi, ticket numbers, etc.).
const TRACKING_PATTERN = /^(CR-[A-Z0-9]{4,16})$/i;

function extractTrackingCode(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Direct match
    const direct = trimmed.match(TRACKING_PATTERN);
    if (direct) return direct[1].toUpperCase();
    // Forgiving: pull the first CR-xxx substring from larger payloads
    // (in case a future version wraps the code in JSON / URL).
    const embedded = trimmed.match(/CR-[A-Z0-9]{4,16}/i);
    if (embedded) return embedded[0].toUpperCase();
    return null;
}

type QrScanModalProps = {
    open: boolean;
    onClose: () => void;
    /** Called with the cleaned tracking code after a successful decode. */
    onDecoded: (trackingCode: string) => void;
};

export default function QrScanModal({ open, onClose, onDecoded }: QrScanModalProps) {
    // Callback ref — runs the moment the <video> element mounts / unmounts
    // inside Radix's portal. We use a state-backed ref so the start effect
    // can wait for BOTH `open === true` AND the video element to actually
    // exist in the DOM before asking getUserMedia; without this, zxing
    // creates a detached video element and the preview stays black even
    // though frames are decoding.
    const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
    const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
        setVideoEl(el);
    }, []);

    const controlsRef = useRef<IScannerControls | null>(null);
    const readerRef = useRef<BrowserQRCodeReader | null>(null);
    const hasDecodedRef = useRef<boolean>(false);

    const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [torchSupported, setTorchSupported] = useState<boolean>(false);
    const [torchOn, setTorchOn] = useState<boolean>(false);
    const [lastRejected, setLastRejected] = useState<string>('');

    // Reset state on open changes
    useEffect(() => {
        if (open) {
            hasDecodedRef.current = false;
            setStatus('starting');
            setErrorMsg('');
            setLastRejected('');
            setTorchSupported(false);
            setTorchOn(false);
        } else {
            setStatus('idle');
        }
    }, [open]);

    // ── Start the camera when both the modal is open AND the <video> is mounted ──
    useEffect(() => {
        if (!open || !videoEl) return;

        const reader = new BrowserQRCodeReader();
        readerRef.current = reader;
        let cancelled = false;

        (async () => {
            try {
                // Prefer the rear camera for scanning paper labels.
                const constraints: MediaStreamConstraints = {
                    video: {
                        facingMode: { ideal: 'environment' },
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                    },
                    audio: false,
                };

                const controls = await reader.decodeFromConstraints(
                    constraints,
                    videoEl,
                    (result, err) => {
                        if (hasDecodedRef.current) return;

                        if (result) {
                            const raw = result.getText();
                            const code = extractTrackingCode(raw);
                            if (!code) {
                                // Rejected — show a transient hint, keep scanning.
                                setLastRejected(raw.length > 24 ? raw.slice(0, 24) + '…' : raw);
                                return;
                            }
                            hasDecodedRef.current = true;
                            // Haptic feedback on mobile if supported.
                            try {
                                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                                    navigator.vibrate(80);
                                }
                            } catch {
                                // ignore
                            }
                            onDecoded(code);
                        }

                        // Silent-suppress the expected "no QR in this frame" stream.
                        // These fire continuously at ~30fps while scanning and are
                        // NOT errors — just the decoder signalling "nothing in this
                        // frame, show me the next one". In dev mode Vite mangles
                        // class names so we match by prefix (e.g. NotFoundException2).
                        const expectedNames = /^(NotFoundException|ChecksumException|FormatException)\d*$/;
                        if (err && err.name && !expectedNames.test(err.name)) {
                            console.warn('[qr-scan] decode error', err);
                        }
                    },
                );

                // The modal was closed or the effect re-ran before the stream
                // came back — kill it immediately so we don't leak the camera.
                if (cancelled) {
                    try { controls.stop(); } catch { /* ignore */ }
                    return;
                }

                controlsRef.current = controls;

                // Some browsers need an explicit play() after srcObject is set
                // inside a portal, otherwise the stream is attached but the
                // element never starts rendering frames.
                try {
                    await videoEl.play();
                } catch (e) {
                    console.warn('[qr-scan] video.play() failed (usually harmless)', e);
                }

                setStatus('scanning');

                // Detect torch capability on the active track.
                try {
                    const stream = (videoEl.srcObject as MediaStream | null) || null;
                    const track = stream?.getVideoTracks()?.[0] || null;
                    const caps = (track?.getCapabilities?.() || {}) as any;
                    if (caps.torch) setTorchSupported(true);
                } catch {
                    // ignore
                }
            } catch (e: any) {
                console.error('[qr-scan] failed to start camera', e);
                const name = e?.name || '';
                let msg = 'Impossible de démarrer la caméra.';
                if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
                    msg = 'Permission refusée. Autorisez l\'accès à la caméra.';
                } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                    msg = 'Aucune caméra détectée sur cet appareil.';
                } else if (name === 'NotReadableError' || name === 'TrackStartError') {
                    msg = 'La caméra est déjà utilisée par une autre application.';
                } else if (e?.message) {
                    msg = e.message;
                }
                setErrorMsg(msg);
                setStatus('error');
            }
        })();

        // Cleanup on close / unmount / dep change
        return () => {
            cancelled = true;
            try {
                controlsRef.current?.stop();
            } catch {
                // ignore
            }
            controlsRef.current = null;
            readerRef.current = null;
            hasDecodedRef.current = false;
            const stream = (videoEl?.srcObject as MediaStream | null) || null;
            if (stream) {
                try {
                    stream.getTracks().forEach((t) => t.stop());
                } catch {
                    // ignore
                }
                if (videoEl) videoEl.srcObject = null;
            }
        };
    }, [open, videoEl, onDecoded]);

    const toggleTorch = async () => {
        const stream = (videoEl?.srcObject as MediaStream | null) || null;
        const track = stream?.getVideoTracks()?.[0] || null;
        if (!track) return;
        try {
            await track.applyConstraints({ advanced: [{ torch: !torchOn } as any] });
            setTorchOn((v) => !v);
        } catch (e) {
            console.warn('[qr-scan] torch toggle failed', e);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className={cn(
                    'p-0 gap-0 border-none bg-ant-ink overflow-hidden flex flex-col',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.65)]',
                    'sm:max-w-[520px] sm:rounded-3xl sm:max-h-[90vh]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-0 max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[100dvh] max-sm:!max-h-[100dvh]',
                    'max-sm:!rounded-none',
                    '[&>button.absolute]:hidden',
                )}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <DialogTitle className="sr-only">Scanner un QR</DialogTitle>
                <DialogDescription className="sr-only">
                    Pointez la caméra sur le QR code du colis.
                </DialogDescription>

                {/* Video stage */}
                <div className="relative flex-1 bg-ant-ink">
                    <video
                        ref={setVideoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        playsInline
                        muted
                        autoPlay
                    />

                    {/* Viewfinder overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                        {/* Viewfinder frame */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="relative w-[68vmin] max-w-[320px] aspect-square">
                                {/* Orange corners */}
                                <div className="absolute -top-1 -left-1 w-10 h-10 border-t-[3px] border-l-[3px] border-ant-orange rounded-tl-[20px]" />
                                <div className="absolute -top-1 -right-1 w-10 h-10 border-t-[3px] border-r-[3px] border-ant-orange rounded-tr-[20px]" />
                                <div className="absolute -bottom-1 -left-1 w-10 h-10 border-b-[3px] border-l-[3px] border-ant-orange rounded-bl-[20px]" />
                                <div className="absolute -bottom-1 -right-1 w-10 h-10 border-b-[3px] border-r-[3px] border-ant-orange rounded-br-[20px]" />
                                {/* Animated scan line */}
                                {status === 'scanning' && (
                                    <div className="absolute inset-x-4 top-0 h-[2px] bg-gradient-to-r from-transparent via-ant-orange to-transparent shadow-[0_0_14px_rgba(217,118,6,0.7)] animate-[scanline_2.2s_ease-in-out_infinite]" />
                                )}
                            </div>
                        </div>

                        {/* Top gradient + editorial header */}
                        <div className="absolute top-0 left-0 right-0 pt-[max(1rem,env(safe-area-inset-top))] pb-10 bg-gradient-to-b from-ant-ink/90 via-ant-ink/50 to-transparent">
                            <div className="px-5 flex items-center justify-between">
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/65">
                                            Scanner · QR
                                        </span>
                                    </div>
                                    <p className="font-display text-[16px] text-ant-light tracking-[-0.01em]">
                                        Alignez le QR du colis
                                    </p>
                                    <p className="font-serif italic text-[11px] text-ant-light/55">
                                        Tenez la caméra stable à ~15 cm.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="pointer-events-auto w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/15 flex items-center justify-center text-ant-light hover:bg-white/15 transition shrink-0"
                                    aria-label="Fermer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Bottom gradient + status + actions */}
                        <div className="absolute bottom-0 left-0 right-0 pt-12 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-ant-ink/95 via-ant-ink/55 to-transparent">
                            <div className="px-5 space-y-3 pointer-events-auto">
                                {/* Status pill */}
                                <div className="flex items-center justify-center">
                                    {status === 'starting' && (
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15">
                                            <Loader2 className="w-3 h-3 text-ant-light/80 animate-spin" />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/80">
                                                Démarrage…
                                            </span>
                                        </div>
                                    )}
                                    {status === 'scanning' && (
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ant-orange/18 backdrop-blur-md border border-ant-orange/40">
                                            <ScanLine className="w-3 h-3 text-ant-orange" />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light">
                                                Scan en cours
                                            </span>
                                        </div>
                                    )}
                                    {status === 'error' && (
                                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ant-rose/20 backdrop-blur-md border border-ant-rose/40">
                                            <CameraOff className="w-3 h-3 text-ant-rose" />
                                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light">
                                                Erreur
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Rejected hint */}
                                {lastRejected && status === 'scanning' && (
                                    <p className="font-serif italic text-center text-[11px] text-ant-orange/85">
                                        QR non reconnu : « {lastRejected} » — visez un colis DigiCom.
                                    </p>
                                )}

                                {/* Error message */}
                                {status === 'error' && (
                                    <p className="font-serif italic text-center text-[12px] text-ant-light/80 max-w-xs mx-auto">
                                        {errorMsg}
                                    </p>
                                )}

                                {/* Action row */}
                                <div className="flex items-center justify-center gap-2 pt-1">
                                    {torchSupported && status === 'scanning' && (
                                        <button
                                            type="button"
                                            onClick={toggleTorch}
                                            className={cn(
                                                'h-11 w-11 rounded-full backdrop-blur-md border flex items-center justify-center transition-colors',
                                                torchOn
                                                    ? 'bg-ant-orange/25 border-ant-orange/40 text-ant-orange hover:bg-ant-orange/30'
                                                    : 'bg-white/10 border-white/15 text-ant-light/85 hover:bg-white/20',
                                            )}
                                            aria-label={torchOn ? 'Éteindre le flash' : 'Allumer le flash'}
                                        >
                                            <Flashlight className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="h-11 px-6 rounded-full font-medium text-[12px] bg-white/10 backdrop-blur-md border border-white/15 text-ant-light hover:bg-white/15 transition-colors"
                                    >
                                        Annuler
                                    </button>
                                </div>

                                {/* Hint */}
                                <p className="flex items-center justify-center gap-1.5 text-[10px] text-ant-light/40 pt-1">
                                    <Camera className="w-3 h-3" />
                                    Bonne lumière · QR bien plat
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <style>{`
                    @keyframes scanline {
                        0% { transform: translateY(0); }
                        50% { transform: translateY(calc(68vmin - 2px)); }
                        100% { transform: translateY(0); }
                    }
                    @media (min-width: 640px) {
                        @keyframes scanline {
                            0% { transform: translateY(0); }
                            50% { transform: translateY(318px); }
                            100% { transform: translateY(0); }
                        }
                    }
                `}</style>
            </DialogContent>
        </Dialog>
    );
}
