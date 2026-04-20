import { lazy, Suspense, useEffect, useState } from 'react';

const PixelBlast = lazy(() => import('@/components/PixelBlast'));

type BackgroundMode = 'desktop' | 'mobile' | 'reduced';

function detectMode(): BackgroundMode {
    if (typeof window === 'undefined') return 'mobile';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return 'reduced';
    const desktop = window.matchMedia('(min-width: 1024px)').matches;
    return desktop ? 'desktop' : 'mobile';
}

export function AuthBackground() {
    const [mode, setMode] = useState<BackgroundMode>(detectMode);

    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
        const sync = () => setMode(detectMode());
        mq.addEventListener('change', sync);
        rm.addEventListener('change', sync);
        return () => {
            mq.removeEventListener('change', sync);
            rm.removeEventListener('change', sync);
        };
    }, []);

    return (
        <div className="absolute inset-0 overflow-hidden bg-ant-ink" aria-hidden>
            {mode === 'desktop' && (
                <Suspense fallback={<div className="absolute inset-0 bg-ant-ink" />}>
                    <PixelBlast
                        className="absolute inset-0 w-full h-full"
                        variant="square"
                        pixelSize={3}
                        color="#d97757"
                        patternScale={5}
                        patternDensity={0.9}
                        enableRipples
                        rippleSpeed={0.6}
                        rippleThickness={0.21}
                        rippleIntensityScale={1.6}
                        speed={0.9}
                        transparent={false}
                        edgeFade={0.15}
                        autoPauseOffscreen
                    />
                </Suspense>
            )}

            {mode === 'mobile' && (
                <video
                    className="absolute inset-0 w-full h-full object-cover"
                    src="/Background.webm"
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    disablePictureInPicture
                    disableRemotePlayback
                />
            )}

            {/* Readability veil — softer on desktop so pixel blast shows through.
                `pointer-events-none` is critical so click ripples reach the canvas. */}
            <div
                className="absolute inset-0 bg-ant-ink/45 lg:bg-ant-ink/30 pointer-events-none"
                style={{
                    backgroundImage:
                        'radial-gradient(120% 80% at 50% 100%, rgba(20,20,19,0.45) 0%, rgba(20,20,19,0) 60%)',
                }}
            />
        </div>
    );
}
