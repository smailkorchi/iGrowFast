"use strict";

import { useCallback, useEffect, useRef } from "react";
import createGlobe, { COBEOptions } from "cobe";
import { cn } from "@/lib/utils";

const GLOBE_CONFIG: COBEOptions = {
    width: 800,
    height: 800,
    onRender: () => { },
    devicePixelRatio: 2,
    phi: 0,
    theta: 0.3,
    dark: 0,
    diffuse: 1.2,
    mapSamples: 16000,
    mapBrightness: 6,
    baseColor: [1, 1, 1],
    markerColor: [249 / 255, 115 / 255, 22 / 255], // primary #F97316
    glowColor: [1, 1, 1],
    markers: [
        { location: [33.5731, -7.5898], size: 0.1 }, // Casablanca
    ],
};

export const Globe = ({
    className,
    config = GLOBE_CONFIG,
}: {
    className?: string;
    config?: COBEOptions;
}) => {
    // phi and width are instance state — must persist across renders, so use refs.
    // (Previously these were `let` locals that reset on every render, which was a latent bug.)
    const phiRef = useRef(0);
    const widthRef = useRef(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const onRender = useCallback(
        (state: { phi: number; width: number; height: number }) => {
            phiRef.current += 0.005;
            state.phi = phiRef.current;
            state.width = widthRef.current * 2;
            state.height = widthRef.current * 2;
        },
        []
    );

    const onResize = useCallback(() => {
        if (canvasRef.current) {
            widthRef.current = canvasRef.current.offsetWidth;
        }
    }, []);

    useEffect(() => {
        window.addEventListener("resize", onResize);
        onResize();

        const globe = createGlobe(canvasRef.current!, {
            ...config,
            width: widthRef.current * 2,
            height: widthRef.current * 2,
            onRender,
        });

        setTimeout(() => (canvasRef.current!.style.opacity = "1"));
        return () => {
            globe.destroy();
            window.removeEventListener("resize", onResize);
        };
    }, [onRender, onResize, config]);

    return (
        <div
            className={cn(
                "inset-0 mx-auto aspect-[1/1] w-full max-w-[600px] pointer-events-none",
                className
            )}
        >
            <canvas
                className={cn(
                    "size-full opacity-0 transition-opacity duration-500 [contain:layout_paint_size]"
                )}
                ref={canvasRef}
            />
        </div>
    );
};
