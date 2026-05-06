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
                        <div className="rounded-2xl bg-ant-paper shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)] border border-ant-line overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            {imageUrl ? (
                                <img
                                    src={imageUrl}
                                    alt={name}
                                    className="w-full object-contain bg-ant-light"
                                    style={{ maxHeight: '70vh' }}
                                    draggable={false}
                                />
                            ) : (
                                <div className="w-full h-72 bg-ant-light flex items-center justify-center">
                                    <Package className="w-20 h-20 text-ant-mid" strokeWidth={1.25} />
                                </div>
                            )}
                            <div className="px-5 py-4 space-y-1.5 border-t border-ant-line">
                                <p className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    {code || 'Sans code'}
                                </p>
                                <p className="font-display text-[16px] font-semibold leading-snug line-clamp-3 break-words text-ant-ink">
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
