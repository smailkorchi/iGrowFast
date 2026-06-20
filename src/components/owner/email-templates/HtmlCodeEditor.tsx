import { useRef } from 'react';
import { Code2 } from 'lucide-react';

interface HtmlCodeEditorProps {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    /** "html" tints the chrome label; "text" for the plain-text variant. */
    language?: string;
}

/**
 * Lightweight, dependency-free code editor: a monospace textarea with a chrome
 * header, tab-to-indent, and auto-pairing-free plain editing. Good enough for
 * hand-authoring email HTML without pulling in a heavy editor bundle.
 */
const INDENT = '  ';

const HtmlCodeEditor = ({ value, onChange, placeholder, language = 'html' }: HtmlCodeEditorProps) => {
    const ref = useRef<HTMLTextAreaElement>(null);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const setSel = (s: number, eend: number) =>
            requestAnimationFrame(() => { el.selectionStart = s; el.selectionEnd = eend; });

        // Collapsed cursor: insert / remove a single indent at the caret.
        if (start === end) {
            if (e.shiftKey) {
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const removed = (value.slice(lineStart, start).match(/ {1,2}$/) || [''])[0].length;
                if (!removed) return;
                onChange(value.slice(0, start - removed) + value.slice(start));
                setSel(start - removed, start - removed);
            } else {
                onChange(value.slice(0, start) + INDENT + value.slice(end));
                setSel(start + INDENT.length, start + INDENT.length);
            }
            return;
        }

        // Selection: indent / outdent every spanned line, keeping the text selected.
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lines = value.slice(lineStart, end).split('\n');
        let firstDelta = 0;
        let totalDelta = 0;
        const rewritten = lines.map((ln, i) => {
            if (e.shiftKey) {
                const removed = (ln.match(/^ {1,2}/) || [''])[0].length;
                if (i === 0) firstDelta = -removed;
                totalDelta -= removed;
                return ln.slice(removed);
            }
            if (i === 0) firstDelta = INDENT.length;
            totalDelta += INDENT.length;
            return INDENT + ln;
        });
        onChange(value.slice(0, lineStart) + rewritten.join('\n') + value.slice(end));
        setSel(Math.max(lineStart, start + firstDelta), end + totalDelta);
    };

    const lines = value ? value.split('\n').length : 0;
    const chars = value.length;

    return (
        <div className="flex flex-col h-full rounded-xl border border-ant-line bg-[#fbfbfa] overflow-hidden">
            <div className="flex items-center justify-between px-3 h-9 border-b border-ant-line bg-ant-light/60 shrink-0">
                <div className="flex items-center gap-1.5">
                    <Code2 className="w-3.5 h-3.5 text-ant-mid" />
                    <span className="font-display text-[10px] uppercase tracking-[0.2em] text-ant-mid">{language}</span>
                </div>
                <span className="font-mono text-[10px] text-ant-mid tabular-nums">
                    {lines} ln · {chars} ch
                </span>
            </div>
            <textarea
                ref={ref}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                wrap="off"
                className="flex-1 w-full resize-none bg-transparent px-3.5 py-3 font-mono text-[12.5px] leading-[1.6] text-ant-ink placeholder:text-ant-mid/50 focus:outline-none whitespace-pre overflow-auto"
            />
        </div>
    );
};

export default HtmlCodeEditor;
