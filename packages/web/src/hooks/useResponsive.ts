import { useEffect, useState } from 'react';

export type Device = 'mobile' | 'tablet' | 'desktop';
export type Orientation = 'portrait' | 'landscape';

export interface Responsive {
  device: Device;
  orientation: Orientation;
  width: number;
  height: number;
}

function compute(): Responsive {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const device: Device = w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
  const orientation: Orientation = h >= w ? 'portrait' : 'landscape';
  return { device, orientation, width: w, height: h };
}

/**
 * True when we should treat soft-keyboard pop-ups as expensive — i.e. when the
 * primary pointer is coarse (touch screen) OR the viewport is phone-sized so
 * the keyboard would cover most of the UI. Either signal is enough.
 */
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const narrow = window.innerWidth < 768;
  return coarse || narrow;
}

export function useResponsive(): Responsive {
  const [r, setR] = useState<Responsive>(() => compute());
  useEffect(() => {
    let pending = 0;
    const onResize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => setR(compute()));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      cancelAnimationFrame(pending);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return r;
}
