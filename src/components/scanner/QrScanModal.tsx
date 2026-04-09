/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import {
    BrowserQRCodeReader,
    type IScannerControls,
} from '@zxing/browser';
import { Camera, CameraOff, X, Flashlight, Loader2, ScanLine } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const controlsRef = useRef<IScannerControls | null>(null);
    const readerRef = useRef<BrowserQRCodeReader | null>(null);
    const hasDecodedRef = useRef<boolean>(false);

    const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [torchSupported, setTorchSupported] = useState<boolean>(false);
    const [torchOn, setTorchOn] = useState<boolean>(false);
    const [lastRejected, setLastRejected] = useState<string>('');

    // ── Start the camera whenever the modal opens ───────────────────────────
    useEffect(() => {
        if (!open) return;

        // Reset state on open
        hasDecodedRef.current = false;
        setStatus('starting');
        setErrorMsg('');
        setLastRejected('');
        setTorchSupported(false);
        setTorchOn(false);

        const reader = new BrowserQRCodeReader();
        readerRef.current = reader;

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
                    videoRef.current || undefined,
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

                        // `err` fires on every frame that fails to decode — that's normal.
                        // Only surface real exceptions (not the expected NotFoundException stream).
                        if (err && err.name && err.name !== 'NotFoundException' && err.name !== 'ChecksumException' && err.name !== 'FormatException') {
                            console.warn('[qr-scan] decode error', err);
                        }
                    },
                );
                controlsRef.current = controls;
                setStatus('scanning');

                // Try to detect torch capability on the active track.
                try {
                    const videoEl = videoRef.current;
                    const stream = (videoEl?.srcObject as MediaStream | null) || null;
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

        // Cleanup on close / unmount
        return () => {
            try {
                controlsRef.current?.stop();
            } catch {
                // ignore
            }
            controlsRef.current = null;
            readerRef.current = null;
            hasDecodedRef.current = false;
            const videoEl = videoRef.current;
            const stream = videoEl?.srcObject as MediaStream | null;
            if (stream) {
                try {
                    stream.getTracks().forEach((t) => t.stop());
                } catch {
                    // ignore
                }
                videoEl.srcObject = null;
            }
        };
    }, [open, onDecoded]);

    const toggleTorch = async () => {
        const videoEl = videoRef.current;
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
                    'p-0 border-none bg-black overflow-hidden flex flex-col gap-0',
                    'sm:max-w-[520px] sm:rounded-[32px] sm:max-h-[90vh]',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-0 max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[100dvh] max-sm:!max-h-[100dvh]',
                    'max-sm:!rounded-none'
                )}
                // hide the built-in close X (we provide our own)
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                {/* Hidden for accessibility — the visual title is rendered below. */}
                <DialogTitle className="sr-only">Scan QR code</DialogTitle>
                <DialogDescription className="sr-only">
                    Pointez la caméra sur le QR code du colis.
                </DialogDescription>

                {/* Video stage */}
                <div className="relative flex-1 bg-black">
                    <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        playsInline
                        muted
                        autoPlay
                    />

                    {/* Viewfinder overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                        {/* Darkened mask with square cutout */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="relative w-[68vmin] max-w-[320px] aspect-square">
                                {/* Corners */}
                                <div className="absolute -top-1 -left-1 w-10 h-10 border-t-[3px] border-l-[3px] border-emerald-400 rounded-tl-[20px]" />
                                <div className="absolute -top-1 -right-1 w-10 h-10 border-t-[3px] border-r-[3px] border-emerald-400 rounded-tr-[20px]" />
                                <div className="absolute -bottom-1 -left-1 w-10 h-10 border-b-[3px] border-l-[3px] border-emerald-400 rounded-bl-[20px]" />
                                <div className="absolute -bottom-1 -right-1 w-10 h-10 border-b-[3px] border-r-[3px] border-emerald-400 rounded-br-[20px]" />
                                {/* Animated line */}
                                {status === 'scanning' && (
                                    <div className="absolute inset-x-4 top-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.8)] animate-[scanline_2.2s_ease-in-out_infinite]" />
                                )}
                            </div>
                        </div>

                        {/* Top gradient + title */}
                        <div className="absolute top-0 left-0 right-0 pt-[max(1rem,env(safe-area-inset-top))] pb-8 bg-gradient-to-b from-black/80 to-transparent">
                            <div className="px-5 flex items-center justify-between">
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-300/75">
                                        QR Scanner
                                    </p>
                                    <p className="text-sm font-bold text-white mt-0.5">
                                        Alignez le QR du colis
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="pointer-events-auto w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/15 flex items-center justify-center text-white hover:bg-white/20 transition"
                                    aria-label="Fermer"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Bottom gradient + status + actions */}
                        <div className="absolute bottom-0 left-0 right-0 pt-10 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/85 to-transparent">
                            <div className="px-5 space-y-3 pointer-events-auto">
                                {/* Status pill */}
                                <div className="flex items-center justify-center">
                                    {status === 'starting' && (
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15">
                                            <Loader2 className="w-3 h-3 text-white/80 animate-spin" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
                                                Démarrage…
                                            </span>
                                        </div>
                                    )}
                                    {status === 'scanning' && (
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 backdrop-blur-md border border-emerald-400/30">
                                            <ScanLine className="w-3 h-3 text-emerald-300" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-200">
                                                Scan en cours
                                            </span>
                                        </div>
                                    )}
                                    {status === 'error' && (
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/15 backdrop-blur-md border border-red-400/30">
                                            <CameraOff className="w-3 h-3 text-red-300" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-red-200">
                                                Erreur
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Rejected hint (wrong QR content, not ours) */}
                                {lastRejected && status === 'scanning' && (
                                    <p className="text-center text-[10px] font-semibold text-amber-300/90">
                                        QR non reconnu : « {lastRejected} ». Visez un colis DigiCom.
                                    </p>
                                )}

                                {/* Error message */}
                                {status === 'error' && (
                                    <p className="text-center text-xs font-semibold text-red-200 max-w-xs mx-auto">
                                        {errorMsg}
                                    </p>
                                )}

                                {/* Action row */}
                                <div className="flex items-center justify-center gap-3 pt-1">
                                    {torchSupported && status === 'scanning' && (
                                        <Button
                                            type="button"
                                            onClick={toggleTorch}
                                            variant="ghost"
                                            className={cn(
                                                'h-12 w-12 rounded-full backdrop-blur-md border',
                                                torchOn
                                                    ? 'bg-amber-400/25 border-amber-300/40 text-amber-200 hover:bg-amber-400/30'
                                                    : 'bg-white/10 border-white/15 text-white/85 hover:bg-white/20'
                                            )}
                                            aria-label={torchOn ? 'Éteindre le flash' : 'Allumer le flash'}
                                        >
                                            <Flashlight className="w-5 h-5" />
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        onClick={onClose}
                                        className="h-12 px-6 rounded-full font-bold text-xs uppercase tracking-widest bg-white/10 backdrop-blur-md border border-white/15 text-white hover:bg-white/20"
                                    >
                                        Annuler
                                    </Button>
                                </div>

                                {/* Hint */}
                                <p className="text-center text-[10px] font-medium text-white/40 pt-1">
                                    <Camera className="inline w-3 h-3 mr-1 -mt-0.5" />
                                    Tenez le téléphone à ~15 cm du QR · bonne lumière
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
