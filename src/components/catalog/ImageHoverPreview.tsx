import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Package } from 'lucide-react';

interface ImageHoverPreviewProps {
    imageUrl: string | null | undefined;
    name: string;
    code: string;
    /** Fallback icon when there is no image. Defaults to Package. */
    fallbackIcon?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * Wraps a card image area and shows a large floating preview
 * with the item image, name, and SKU on hover.
 */
export function ImageHoverPreview({
    imageUrl,
    name,
    code,
    children,
}: ImageHoverPreviewProps) {
    const [visible, setVisible] = useState(false);
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const triggerRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);

    const show = useCallback(() => setVisible(true), []);
    const hide = useCallback(() => {
        setVisible(false);
        cancelAnimationFrame(rafRef.current);
    }, []);

    const handleMove = useCallback((e: React.MouseEvent) => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            setPos({ x: e.clientX, y: e.clientY });
        });
    }, []);

    // Clean up raf on unmount
    useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

    // Compute preview position so it stays within the viewport
    const previewWidth = 560;
    const previewMaxHeight = 800;
    let left = pos.x + 16;
    let top = pos.y + 16;

    if (typeof window !== 'undefined') {
        if (left + previewWidth > window.innerWidth - 12) {
            left = pos.x - previewWidth - 16;
        }
        if (top + previewMaxHeight > window.innerHeight - 12) {
            top = window.innerHeight - previewMaxHeight - 12;
        }
        if (top < 12) top = 12;
        if (left < 12) left = 12;
    }

    return (
        <div
            ref={triggerRef}
            onMouseEnter={show}
            onMouseLeave={hide}
            onMouseMove={handleMove}
            className="contents"
        >
            {children}
            {visible &&
                createPortal(
                    <div
                        ref={previewRef}
                        style={{
                            position: 'fixed',
                            left,
                            top,
                            width: previewWidth,
                            zIndex: 9999,
                            pointerEvents: 'none',
                        }}
                        className="animate-in fade-in zoom-in-95 duration-150"
                    >
                        <div className="rounded-3xl bg-white shadow-2xl border border-gray-100/80 ring-1 ring-black/5">
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt={name}
                                    className="w-full rounded-t-3xl object-contain bg-gray-50"
                                    style={{ maxHeight: '70vh' }}
                                    draggable={false}
                                />
                            ) : (
                                <div className="w-full h-72 bg-brand-navy/[0.04] flex items-center justify-center rounded-t-3xl">
                                    <Package className="w-24 h-24 text-brand-navy/15" />
                                </div>
                            )}
                            <div className="px-5 py-4 space-y-1.5">
                                <p className="text-xs font-black uppercase tracking-widest text-brand-navy/40 truncate">
                                    {code}
                                </p>
                                <p className="text-lg font-bold text-brand-navy leading-snug line-clamp-3 break-words">
                                    {name}
                                </p>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </div>
    );
}
