# Hero animation — Higgsfield generation prompts — 2026-08-31

Companion of `CONCEPT-AND-ANCHORS.md` (palette, 40-anchor DOM docking map, risks).
Settings: **Seedance 2.5 Pro via Higgsfield · text-to-video · 10s · 16:9 · highest resolution tier offered · generate 3–4 takes, keep the cleanest geometry.** The video carries zero text/logos by design — the site's DOM pill-chips (the existing text chips) composite on top.

---

## PRIMARY PROMPT (paste as-is)

Flat vector motion graphics in the style of a precision instrument diagram: thin uniform strokes, flat color fills, crisp edges, no texture, no grain, no paper, no 3D shading, no gradients except a single soft glow inside the central wheel. Deep midnight-navy engineered background, hex 070C16. Chassis shapes hex 101A2B, faint structure lines hex 22314A. Luminous signal colors: cobalt 5B7CFA, violet 9A7CF7, mint-teal 34D3B0, amber FFB454, a single thin gold line E8B54A, and ice-white EAF1FF as the brightest element in frame.

Camera: locked-off static frame, flat head-on orthographic view, wide flat field of view, zero camera movement, zero parallax, zero zoom. All motion is internal to the mechanism.

Tone: calm, exact, quiet, expensive — a watchmaker's mechanism, not a busy factory. The left third of the frame stays near-empty dark plate for headline space; the mechanism occupies the center and right.

The scene: streams of small identical rounded-square tokens flow along clean orthogonal channel rails. From the top right, a comb of vertical channels carries cobalt tokens downward. From the top middle, a smaller comb carries violet and mint-teal tokens downward. From the right edge, horizontal channels carry amber tokens leftward. All channels bend and merge into one vertical collector column where tokens queue into strict single file with interleaving colors. The column feeds a large slowly rotating wheel whose hub is a bold eight-pointed Moroccan star; the wheel turns in small rhythmic steps and releases tokens in a steady heartbeat onto two horizontal rails running right to left. Beneath the lower rail a thin gold line illuminates progressively from right to left. The two rails converge at a junction left of center; at the junction every token turns ice-white, and the single white stream passes through five small glowing ring apertures with subtle eight-lobed edges, exiting the frame along the lower left on perfect spacing.

Timestamped beats:
0.0–2.5s: tokens descend the intake combs and slide in from the right edge, each family in its own color, steady rhythm.
2.0–4.0s: channels bend into the vertical collector; tokens interleave into single file, spacing normalizes — chaos becomes order.
3.0–6.5s: the star-hub wheel turns in small steps, releasing tokens in a steady pulse onto the two leftward rails; the thin gold line lights up under the lower rail.
6.5–9.0s: the rails converge; tokens turn ice-white and thread through the five ring apertures as one perfect stream.
9.0–10.0s: the stream exits lower left; every element returns exactly to its starting position.

Seamless loop: the final frame is identical to the first frame; all motion is periodic and continuous across the cut.

No text, no letters, no numbers, no logos, no brand marks, no icons of real apps, no watermarks, no labels, no UI elements.

---

## FALLBACK PROMPT (if take 1 smears the mechanism)

Same style block, camera block, tone block and suppression block as the primary. Replace the scene and beats with:

The scene: dozens of luminous signal streams — cobalt, violet, mint-teal, amber — flow inward from the top and right edges across a deep midnight-navy field, each stream a clean vector ribbon carrying small identical rounded-square pulses. The streams converge on a large eight-pointed Moroccan star emblem right of center that breathes with a slow heartbeat glow. On each beat, the star absorbs the incoming pulses and emits one wide, calm, ice-white band that sweeps leftward through five small glowing ring apertures and exits the lower left edge on perfect spacing. The left third of the frame stays near-empty dark for headline space.

Beats: 0.0–3.0s streams flow inward, chaotic spacing. 3.0–6.0s streams bend toward the star, spacing synchronizes. 6.0–9.0s the star beats twice, white bands sweep left through the rings. 9.0–10.0s all elements return exactly to their starting positions. Seamless loop.

---

## Post-generation checklist

1. Loop check: diff first vs last frame; if not identical, crossfade the final 0.5s in post (or ping-pong as last resort).
2. Re-encode per HOMEPAGE-ARCHITECTURE.md §3: dense keyframes (`-g 8` desktop / `-g 4` phone) if the hero ever scrubs; plain loop needs only a normal encode.
3. Poster frame = frame 0 (reduced-motion visitors and crawlers get the poster, per site motion rules).
4. Mobile: CSS re-crop centers on the collector + wheel (the judges' mobile graft) — the anchor map in CONCEPT-AND-ANCHORS.md lists which chips survive the narrow crop.

## Chip compositing (summary — full 40-anchor map in CONCEPT-AND-ANCHORS.md)

- Video supplies world + motion only. Crisp SVG anchor furniture + DOM pill-chips overlay at fixed normalized coordinates — chips never track video features.
- Carrier comb (top right): Ameex · Coliaty · OzonExpress bright/solid (configured in production); Sendit · Digylog · Vitex · Forcelog · Quick Livraison · Delvo Express dimmed with a "built" state — the honesty rule from the integration-strip doc, enforced in DOM styling.
- Right-edge comb: Google Sheets · Google Analytics · Meta Ads · one grouped chip "attribute revenue to any channel" (TikTok/Snap/YouTube/… — never presented as adapters).
- Top-middle comb: WhatsApp (text only, never the mark) · Email · Notifications.
- Gate rails: the module chips — Commandes · Leads Review · Stock · Comptabilité · Commissions · Bons de livraison · Colis & Tracking · WhatsApp Inbox · Campagnes · Exports · Imports · Équipe · Clients · Canaux de vente · Demandes · Devis & Factures.
- The five ring apertures = the five roles: Owner · Admin · Seller · Media Buyer · Courier.
- Nothing money-shaped anywhere; the gold line is an accounting line ("track and reconcile COD" posture).

---

# V2 — 2026-08-31, after take 1 failed

Take 1 diagnosis: "instrument diagram / structure lines / orthographic" vocabulary triggered the blueprint prior (grid-blue wash, line-art star, subway-dot streams); hex codes alone can't override style priors; too many simultaneous mechanisms. V1 text-to-video prompts above are DEPRECATED.

New workflow: (1) generate the KEYFRAME as an image, iterate until approved; (2) image-to-video with a motion-only prompt. Composition lives in the image; the video model only animates.

## V2 KEYFRAME IMAGE PROMPT (16:9)

Premium dark motion-graphics keyframe, flat vector art. Background: uniform near-black deep navy, hex 070C16, completely clean — no blueprint grid, no diagram lines, no texture, no vignette. All light comes from the artwork. Dozens of luminous dotted streams flow in clean right-angle paths with rounded corners from the top edge and right edge toward a single hero emblem placed at two-thirds right: streams of small glowing dots in electric cobalt 5B7CFA, violet 9A7CF7, mint-teal 34D3B0 and amber FFB454 — each stream one pure color, dots perfectly evenly spaced. The hero emblem is a LARGE bold eight-pointed Moroccan star drawn in thick luminous ice-white and gold strokes with a soft radiant glow — clearly the biggest and brightest element in the frame. From the star, one single stream of pure ice-white glowing dots, hex EAF1FF, flows leftward through five small evenly spaced glowing ring outlines and exits at the lower left. The left third of the frame is empty dark space reserved for a headline. Crisp edges, very high contrast, expensive minimal look. No text, no letters, no numbers, no logos, no watermarks, no UI elements.

## V2 MOTION PROMPT (image-to-video, 10s, from the approved keyframe)

Animate this exact frame, changing nothing about its composition, colors, shapes or background. Locked-off static camera: no zoom, no pan, no parallax, no drift. Motion only: every dotted stream flows steadily along its own path toward the large eight-pointed star; the star glows in a slow heartbeat pulse, brightening slightly as streams arrive; the single white dotted stream flows continuously leftward through the five rings and exits the frame. Constant speeds, perfectly even dot spacing, calm precise rhythm throughout. Seamless loop: the final frame is identical to the first frame. No text, no letters, no logos, no watermarks.

## Standing recommendation

This concept (flat vector, exact geometry, perfect loop, DOM chips docking) is also fully buildable in code — SVG + GSAP renders it pixel-perfect, loops exactly, weighs less than the MP4, and the chips become native. If two image-to-video rounds don't satisfy, build it in code instead of a third round.
