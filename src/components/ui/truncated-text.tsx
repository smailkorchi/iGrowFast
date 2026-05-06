import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type TruncatedTextProps = {
    text: string | null | undefined;
    className?: string;
    /** Render element. Defaults to 'span'. Use 'h3', 'p', etc. as needed. */
    as?: keyof JSX.IntrinsicElements;
    /** Optional max width for the tooltip content. */
    tooltipMaxWidth?: number;
    /** Tooltip side. Defaults to 'top'. */
    side?: 'top' | 'right' | 'bottom' | 'left';
};

/**
 * Renders text that is visually truncated (single-line `truncate` or
 * multi-line `line-clamp-N`) and shows a Radix tooltip with the full
 * content on hover/focus — but only when the text actually overflows.
 *
 * Drop-in: keep your existing `truncate` / `line-clamp-2` / etc.
 * classes; pass them via the `className` prop.
 */
export const TruncatedText = React.forwardRef<HTMLElement, TruncatedTextProps>(
    function TruncatedText(
        { text, className, as = 'span', tooltipMaxWidth = 360, side = 'top' },
        forwardedRef
    ) {
        const innerRef = React.useRef<HTMLElement | null>(null);
        const [overflowing, setOverflowing] = React.useState(false);

        const setRef = React.useCallback(
            (node: HTMLElement | null) => {
                innerRef.current = node;
                if (typeof forwardedRef === 'function') forwardedRef(node);
                else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLElement | null>).current = node;
            },
            [forwardedRef]
        );

        const measure = React.useCallback(() => {
            const el = innerRef.current;
            if (!el) {
                setOverflowing(false);
                return;
            }
            // Width overflow (single-line truncate) OR height overflow (line-clamp).
            const isOverflow =
                el.scrollWidth > el.clientWidth + 1 ||
                el.scrollHeight > el.clientHeight + 1;
            setOverflowing(isOverflow);
        }, []);

        React.useLayoutEffect(() => {
            measure();
        }, [measure, text]);

        React.useEffect(() => {
            const el = innerRef.current;
            if (!el || typeof ResizeObserver === 'undefined') return;
            const ro = new ResizeObserver(() => measure());
            ro.observe(el);
            return () => ro.disconnect();
        }, [measure]);

        const Tag = as as React.ElementType;

        // Always wrap with Tooltip + Trigger so the DOM element identity is
        // stable across overflow-state changes (no remount, no layout flicker).
        // The TooltipContent is only rendered when overflow is detected, so
        // hovering a non-truncated element does nothing.
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <Tag ref={setRef} className={className}>
                        {text}
                    </Tag>
                </TooltipTrigger>
                {overflowing && text ? (
                    <TooltipContent
                        side={side}
                        className={cn('break-words')}
                        style={{ maxWidth: tooltipMaxWidth }}
                    >
                        {text}
                    </TooltipContent>
                ) : null}
            </Tooltip>
        );
    }
);
