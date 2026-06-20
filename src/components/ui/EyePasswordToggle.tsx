/**
 * EyePasswordToggle — a self-contained, animated show/hide-password eye.
 *
 * A premium line-art eye that physically opens (lid morph), does a few groggy
 * "just woke up" blinks, then loops a curious behaviour: a slow sneaky peek
 * toward the password, gets caught (fast withdrawal + shake), glances away,
 * acts innocent, and peeks again. Pure SVG + Web Animations API + CSS — no
 * external dependencies beyond React. Inherits color via `currentColor`.
 *
 * Controlled component: the parent owns the boolean + the <input type>.
 *
 * @example
 *   const [show, setShow] = useState(false);
 *   <div className="relative">
 *     <input type={show ? 'text' : 'password'} className="pr-12 ..." />
 *     <EyePasswordToggle
 *       revealed={show}
 *       onToggle={() => setShow(v => !v)}
 *       className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
 *     />
 *   </div>
 */
import { useCallback, useEffect, useId, useRef } from 'react';

const OPEN_D = 'M16 60 Q60 12 104 60 Q60 108 16 60 Z';
const CLOSED_D = 'M16 60 Q60 72 104 60 Q60 76 16 60 Z';

const STYLE_ID = 'ep-eye-toggle-styles';
const CSS = `
.epEye .epOutline{ d:path("${CLOSED_D}"); transition:d .58s cubic-bezier(.34,1.06,.5,1); }
.epEye.epOpen .epOutline{ d:path("${OPEN_D}"); }
.epEye .epLashes{ opacity:0; transform:translateY(9px); transform-box:fill-box; transform-origin:60px 30px; transition:opacity .42s ease, transform .54s cubic-bezier(.34,1.12,.5,1); }
.epEye.epOpen .epLashes{ opacity:1; transform:translateY(0); }
.epEye .epPupil{ opacity:0; transform-box:fill-box; transform-origin:center; transition:opacity .4s ease, transform .5s ease; }
.epEye.epOpen .epPupil{ opacity:1; }
.epEye .epGaze{ transition:transform .9s cubic-bezier(.33,0,.2,1); }
@media (prefers-reduced-motion:reduce){ .epEye .epOutline,.epEye .epLashes,.epEye .epPupil,.epEye .epGaze{ transition-duration:.12s !important; } }
`;
function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
}

export interface EyePasswordToggleProps {
    /** Whether the password is currently revealed (controlled). */
    revealed: boolean;
    /** Called when the eye is clicked. */
    onToggle: () => void;
    /** Icon width in px (height scales to the 120×100 viewBox). Default 30. */
    size?: number;
    /** Classes for the wrapping <button> (set color/positioning here). */
    className?: string;
    /** Accessible labels. */
    labels?: { show: string; hide: string };
}

export function EyePasswordToggle({ revealed, onToggle, size = 30, className, labels }: EyePasswordToggleProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const outlineRef = useRef<SVGPathElement>(null);
    const lashesRef = useRef<SVGGElement>(null);
    const pupilRef = useRef<SVGCircleElement>(null);
    const gazeRef = useRef<SVGGElement>(null);
    const timers = useRef<number[]>([]);
    const live = useRef(false);
    const clipId = 'ep' + useId().replace(/[^a-zA-Z0-9]/g, '');

    useEffect(ensureStyles, []);

    const clearSeq = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

    const move = useCallback((x: number, y: number, dur: number, ease: string) => {
        const g = gazeRef.current; if (!g) return;
        g.style.transition = `transform ${dur}ms ${ease}`;
        g.style.transform = `translate(${x}px, ${y}px)`;
    }, []);
    const dilate = useCallback((scale: number, dur: number) => {
        const p = pupilRef.current; if (!p) return;
        p.style.transition = `transform ${dur}ms ease, opacity .35s ease`;
        p.style.transform = `scale(${scale})`;
    }, []);
    const shake = useCallback(() => {
        svgRef.current?.animate(
            [{ transform: 'translateX(0)' }, { transform: 'translateX(-2.6px)' }, { transform: 'translateX(2.2px)' },
             { transform: 'translateX(-1.5px)' }, { transform: 'translateX(1px)' }, { transform: 'translateX(0)' }],
            { duration: 270, easing: 'ease-out' });
    }, []);
    const blink = useCallback((dur = 210) => {
        if (!live.current) return;
        outlineRef.current?.animate([{ d: `path("${OPEN_D}")` }, { d: `path("${CLOSED_D}")` }, { d: `path("${OPEN_D}")` }], { duration: dur, easing: 'ease-in-out' });
        pupilRef.current?.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }], { duration: dur, easing: 'ease-in-out' });
        lashesRef.current?.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: .12, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: dur, easing: 'ease-in-out' });
    }, []);

    const curiousCycle = useCallback(() => {
        if (!live.current) return;
        const SLOW = 'cubic-bezier(.35,0,.25,1)', DART = 'cubic-bezier(.5,0,.92,.45)', SOFT = 'cubic-bezier(.4,0,.2,1)';
        const g = (fn: () => void) => () => { if (live.current) fn(); };
        // 1 · slow two-stage creep toward the password (left & slightly above centre)
        move(-7, -2, 1100, SLOW); dilate(1.1, 1100);
        at(1380, g(() => { move(-17, -5, 1250, SLOW); dilate(1.3, 1250); }));
        // 2 · caught — startle shake
        const caught = 1380 + 1250 + 360;
        at(caught, g(() => { shake(); dilate(0.78, 120); }));
        // 3 · withdrawal — the only fast move (guilty dart up & away)
        at(caught + 170, g(() => move(16, -13, 230, DART)));
        // 4 · slowly return to front, act normal, blink twice
        const front = caught + 170 + 230 + 260;
        at(front, g(() => { move(0, 0, 1000, SOFT); dilate(1, 780); }));
        at(front + 1050, g(() => blink()));
        at(front + 1600, g(() => blink()));
        // 5 · slow casual glance the other way, then back
        const away2 = front + 1950;
        at(away2, g(() => move(12, -6, 950, SOFT)));
        at(away2 + 1150, g(() => move(0, 0, 850, SOFT)));
        // 6 · beat → curiosity returns
        at(away2 + 1150 + 850 + 450, g(curiousCycle));
    }, [move, dilate, shake, blink]);

    useEffect(() => {
        const svg = svgRef.current, pupil = pupilRef.current;
        if (!svg) return;
        const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (revealed) {
            live.current = true;
            clearSeq();
            svg.classList.add('epOpen');           // lid morphs open
            move(0, 0, 1, 'linear');
            if (pupil) { pupil.style.transition = 'none'; pupil.style.transform = 'scale(.5)'; }
            requestAnimationFrame(() => requestAnimationFrame(() => dilate(1, 560)));
            if (reduce) return;
            // just woke up: groggy blinks (heavy → lighter), then the curious loop
            at(640, () => blink(340));
            at(1080, () => blink(300));
            at(1500, () => blink(240));
            at(2040, curiousCycle);
        } else {
            live.current = false;
            clearSeq();
            move(0, 0, 150, 'ease'); dilate(1, 150);
            at(130, () => svg.classList.remove('epOpen'));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealed]);

    useEffect(() => () => { live.current = false; clearSeq(); }, []);

    const label = revealed ? (labels?.hide ?? 'Hide password') : (labels?.show ?? 'Show password');

    return (
        <button
            type="button"
            onClick={onToggle}
            aria-label={label}
            title={label}
            className={className}
            style={{ display: 'grid', placeItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
        >
            <svg
                ref={svgRef}
                className="epEye"
                viewBox="0 0 120 100"
                width={size}
                height={Math.round((size * 100) / 120)}
                style={{ overflow: 'visible', display: 'block' }}
                aria-hidden="true"
            >
                <defs><clipPath id={clipId}><path d={OPEN_D} /></clipPath></defs>
                <g fill="none" stroke="currentColor" strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round">
                    <path ref={outlineRef} className="epOutline" d={CLOSED_D} />
                    <g ref={lashesRef} className="epLashes" strokeWidth={5}>
                        <path d="M39 41 Q33 31 32 22" />
                        <path d="M53 37 Q51 27 50 18" />
                        <path d="M67 37 Q69 27 70 18" />
                        <path d="M81 41 Q87 31 88 22" />
                    </g>
                </g>
                <g clipPath={`url(#${clipId})`}>
                    <g ref={gazeRef} className="epGaze"><circle ref={pupilRef} className="epPupil" cx={60} cy={60} r={12} fill="currentColor" /></g>
                </g>
            </svg>
        </button>
    );
}

export default EyePasswordToggle;
