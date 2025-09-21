import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

/**
 * Xenya Logo — Dual-Ring Eye (persistent glow)
 * - Outer purple ring (static)
 * - Inner neon ring draws clockwise ONCE, then stays visible
 * - Purple fog inside (no center dot)
 * - After the first draw, the whole mark stays "lit"
 *
 * Triggers:
 *  - auto on mount (unless reduced motion)
 *  - call ref.play() to re-run the draw (e.g., on Send)
 */
const Logo = forwardRef(function XenyaLogo(
  { size = 40, angle = -28, autoOnMount = true, showWord = true },
  ref
) {
  const toVB = (px) => (px * 100) / size;

  // Total stroke thickness (like a single old ring). Split across two.
  const totalStrokePx = Math.max(2, Math.round(size / 11));
  const totalStrokeVB = toVB(totalStrokePx);

  const outerSW = totalStrokeVB * 0.52; // outer purple width
  const innerSW = totalStrokeVB * 0.48; // inner neon width
  const gapVB   = 0.6;                  // tiny visual gap

  const BASE_R = 44;
  const outerR = BASE_R;
  const innerR = BASE_R - (outerSW / 2 + innerSW / 2 + gapVB);

  const neonCirc = 2 * Math.PI * innerR;

  const wrapRef = useRef(null);
  const ringRef = useRef(null);

  // Run the clockwise draw once, then keep it "lit"
  const runOnce = () => {
    const el = wrapRef.current;
    if (!el) return;

    // Prepare: ensure not lit, so the ring starts undrawn
    el.classList.remove("logo-lit");

    // Restart the animation cleanly
    el.classList.remove("logo-burst");
    // force reflow so animation restarts
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;

    // When the animation ends, mark as lit (keeps ring visible + glow)
    const onEnd = () => {
      el.classList.add("logo-lit");
      el.classList.remove("logo-burst");
      ringRef.current?.removeEventListener("animationend", onEnd);
    };
    ringRef.current?.addEventListener("animationend", onEnd, { once: true });

    el.classList.add("logo-burst");
  };

  useImperativeHandle(ref, () => ({
    play: runOnce,
  }));

  useEffect(() => {
    if (!autoOnMount) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const id = requestAnimationFrame(() => {
      setTimeout(runOnce, 30);
    });
    return () => cancelAnimationFrame(id);
  }, [autoOnMount]); // run once

  const style = useMemo(
    () => ({
      width: size,
      height: size,
      "--logo-tilt": `${angle}deg`,
    }),
    [size, angle]
  );

  return (
    <span ref={wrapRef} className="xenya-logo" aria-label="Xenya">
      <span className="eye" style={style} role="img" aria-hidden="true">
        <svg viewBox="0 0 100 100" width={size} height={size}>
          <defs>
            {/* Purple fog (subtle, no center dot) */}
            <radialGradient id="fog-grad" cx="50%" cy="50%" r="60%">
              <stop offset="0%"  stopColor="var(--violet)" stopOpacity="0.35" />
              <stop offset="65%" stopColor="var(--violet)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--violet)" stopOpacity="0.0" />
            </radialGradient>
            <filter id="fog-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.8" />
            </filter>
          </defs>

          <g transform={`rotate(var(--logo-tilt, ${angle}) 50 50)`}>
            {/* Interior fog */}
            <circle
              cx="50" cy="50"
              r={innerR - innerSW/2 - 1}
              fill="url(#fog-grad)"
              filter="url(#fog-blur)"
            />

            {/* Outer purple ring (static) */}
            <circle
              className="ring-outer"
              cx="50" cy="50" r={outerR}
              fill="none"
              stroke="var(--violet)"
              strokeWidth={outerSW}
              strokeLinecap="round"
            />

            {/* Inner neon ring (draws once, then stays) */}
            <circle
              ref={ringRef}
              className="ring-inner"
              cx="50" cy="50" r={innerR}
              fill="none"
              stroke="var(--cyan)"
              strokeWidth={innerSW}
              strokeLinecap="round"
              style={{ "--neon-circ": neonCirc }}
            />
          </g>
        </svg>
      </span>

      {showWord && <span className="xenya-word">Xenya</span>}
    </span>
  );
});

export default Logo;
