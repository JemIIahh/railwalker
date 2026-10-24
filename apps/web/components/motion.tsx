'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { countAt, formatCount } from '../lib/count';

/** Whether the visitor asked for less motion. False until the page is in the browser, which is when it matters. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const on = () => setReduced(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** True once the element has come into view, and then for good. */
export function useInView<T extends Element>(threshold = 0.25): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/** A number that counts up to its value the first time it is seen. Without motion, or before the browser has it, it simply is the value. */
export function CountUp({ value, decimals = 0, prefix = '', suffix = '', duration = 1200 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const armed = useRef(false);

  useEffect(() => {
    if (!seen || reduced || armed.current) return;
    armed.current = true;
    let frame = 0;
    const start = performance.now();
    setShown(0);
    const tick = (now: number) => {
      const progress = (now - start) / duration;
      setShown(countAt(progress, value, decimals));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, reduced, value, decimals, duration]);

  useEffect(() => {
    if (!armed.current || reduced) setShown(value); // a visitor who turns motion on mid-count, or off, is shown the number itself
  }, [value, reduced]);

  return (
    <span ref={ref} className="count">
      {prefix}
      {formatCount(shown, decimals)}
      {suffix}
    </span>
  );
}

/** Fades its content up the first time it scrolls into view. Content already on screen, or without scripts, is just there. */
export function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'plain' | 'hidden' | 'shown'>('plain');
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (el === null || reduced) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) return; // already in view: leave it alone
    setState('hidden');
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState('shown');
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const style = delay > 0 ? ({ transitionDelay: `${delay}ms` } as CSSProperties) : undefined;
  const now = reduced ? 'plain' : state; // reduced motion never hides anything, even if it was armed a moment ago
  return (
    <div ref={ref} className={`${now === 'plain' ? '' : 'reveal'} ${now === 'shown' ? 'in' : ''} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

/**
 * For a bar or a ring that fills when it is first seen. It is full for anyone without scripts or with reduced motion, empty from
 * the moment the page is live until the element is seen, and then fills: 'final' (full), 'zero' (empty), 'run' (filling).
 */
export function useFill<T extends Element>(threshold = 0.35): [RefObject<T | null>, 'final' | 'zero' | 'run'] {
  const [ref, seen] = useInView<T>(threshold);
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<'final' | 'zero' | 'run'>('final');
  useEffect(() => {
    if (!reduced) setPhase((p) => (p === 'final' ? 'zero' : p));
  }, [reduced]);
  useEffect(() => {
    if (!seen || phase !== 'zero') return;
    const frame = requestAnimationFrame(() => setPhase('run'));
    return () => cancelAnimationFrame(frame);
  }, [seen, phase]);
  return [ref, reduced ? 'final' : phase];
}
