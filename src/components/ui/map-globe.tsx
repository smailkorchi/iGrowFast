"use client";

import { Map } from "./map";
import { cn } from "@/lib/utils";
import { Navigation2, Info } from "lucide-react";
import { Button } from "./button";
import { useState, useRef, useEffect } from "react";
import type MapLibreGL from "maplibre-gl";

interface MapGlobeProps {
    className?: string;
    /** Center coordinates [longitude, latitude] */
    center?: [number, number];
    /** Initial zoom level (default: 1.6) */
    zoom?: number;
    /** Children (usually MapMarker components) */
    children?: React.ReactNode;
    /** Custom color for dots/markers */
    dotColor?: string;
}

export function MapGlobe({
    className,
    center = [20, 10],
    zoom = 2.2,
    children,
    dotColor = "#F97316", // Default primary
}: MapGlobeProps) {
    const mapRef = useRef<MapLibreGL.Map>(null);
    const [isRotating, setIsRotating] = useState(true);

    // Auto-rotation effect
    useEffect(() => {
        let animationFrame: number;

        const rotate = () => {
            if (isRotating) {
                if (mapRef.current) {
                    const centerValue = mapRef.current.getCenter();
                    centerValue.lng += 0.1; // Adjust speed here
                    mapRef.current.setCenter(centerValue);
                }
                animationFrame = requestAnimationFrame(rotate);
            }
        };

        if (isRotating) {
            animationFrame = requestAnimationFrame(rotate);
        }

        return () => cancelAnimationFrame(animationFrame);
    }, [isRotating]);

    const handleFlyTo = () => {
        if (!mapRef.current) return;

        setIsRotating(false);
        mapRef.current.flyTo({
            center: [-7.5898, 33.5731], // Fly to Morocco as an example
            zoom: 4,
            duration: 3000,
            essential: true
        });
    };

    const toggleRotation = () => {
        setIsRotating(!isRotating);
    };

    return (
        <div className={cn(
            "relative aspect-square w-full max-w-[600px] overflow-hidden rounded-[3rem] bg-[#0c0c0c] border border-white/5 shadow-2xl group select-none",
            className
        )}>
            {/* Background Dots Pattern */}
            <div className="absolute inset-0 opacity-[0.15] pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(circle, #888 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

            {/* Fly To Button */}
            <div className="absolute top-8 left-8 z-20">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleFlyTo}
                    className="bg-black/40 backdrop-blur-xl border border-white/10 hover:bg-black/60 text-[10px] font-bold tracking-[0.2em] text-white/90 px-4 py-2 h-auto uppercase rounded-xl transition-all active:scale-95 shadow-lg"
                >
                    FLY TO
                </Button>
            </div>

            {/* Navigation / Rotation Toggle Icon */}
            <div className="absolute top-8 right-8 z-20">
                <button
                    onClick={toggleRotation}
                    type="button"
                    className={cn(
                        "bg-white/5 backdrop-blur-xl border border-white/10 p-3 rounded-2xl text-white/70 hover:text-white transition-all shadow-lg active:scale-90",
                        !isRotating && "bg-primary/20 text-primary border-primary/30"
                    )}
                >
                    <Navigation2 className={cn("w-5 h-5 transition-transform duration-500", isRotating ? "rotate-45" : "rotate-0")} />
                </button>
            </div>

            {/* Internal Map Container */}
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-full rounded-full overflow-hidden shadow-[0_0_120px_rgba(0,0,0,0.8)] border border-white/5">
                    <Map
                        ref={mapRef}
                        projection={{ type: "globe" } as unknown as { type: string }}
                        theme="dark"
                        zoom={zoom}
                        minZoom={2} // Prevent zooming out too far
                        center={center}
                        className="w-full h-full pointer-events-auto"
                        dragRotate={true}
                        attributionControl={false}
                    >
                        {children}
                    </Map>
                </div>
            </div>


            {/* Info Icon */}
            <div className="absolute bottom-8 right-8 z-20">
                <div className="bg-white rounded-full p-2 text-black shadow-2xl cursor-help hover:scale-110 transition-all active:scale-95 group/info">
                    <Info className="w-6 h-6 fill-current" />
                    <div className="absolute bottom-full right-0 mb-4 w-48 p-3 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl text-[10px] text-white/80 opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none">
                        Interactive Global Operations View (GA4 Real-time Data).
                    </div>
                </div>
            </div>

            {/* Atmosphere Glow / Edge Shine */}
            <div className="absolute inset-0 pointer-events-none rounded-[3rem] shadow-[inset_0_0_80px_rgba(255,255,255,0.03)] m-4" />
            <div className="absolute inset-0 pointer-events-none rounded-full border border-white/5 m-12 shadow-[0_0_40px_rgba(255,255,255,0.02)]" />
        </div>
    );
}
