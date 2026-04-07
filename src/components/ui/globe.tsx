"use strict";

import { useCallback, useEffect, useRef, useState } from "react";
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
    let phi = 0;
    let width = 0;
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const onRender = useCallback(
        (state: { phi: number; width: number; height: number }) => {
            phi += 0.005;
            state.phi = phi;
            state.width = width * 2;
            state.height = width * 2;
        },
        []
    );

    const onResize = () => {
        if (canvasRef.current) {
            width = canvasRef.current.offsetWidth;
        }
    };

    useEffect(() => {
        window.addEventListener("resize", onResize);
        onResize();

        const globe = createGlobe(canvasRef.current!, {
            ...config,
            width: width * 2,
            height: width * 2,
            onRender,
        });

        setTimeout(() => (canvasRef.current!.style.opacity = "1"));
        return () => globe.destroy();
    }, [onRender, config]);

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
