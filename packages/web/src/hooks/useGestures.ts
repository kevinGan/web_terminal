import { useEffect } from 'react';

interface GestureHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}

/**
 * Two-finger horizontal swipe → switch tab.
 * Uses pointer events with pointerType='touch' filter.
 */
export function useGestures(handlers: GestureHandlers) {
  useEffect(() => {
    let activeTouches: { id: number; x: number; y: number }[] = [];
    let startX1 = 0, startX2 = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startX1 = e.touches[0]!.clientX;
        startX2 = e.touches[1]!.clientX;
        activeTouches = [
          { id: e.touches[0]!.identifier, x: startX1, y: e.touches[0]!.clientY },
          { id: e.touches[1]!.identifier, x: startX2, y: e.touches[1]!.clientY }
        ];
      } else {
        activeTouches = [];
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (activeTouches.length !== 2) return;
      const ended = e.changedTouches;
      // Find both touches in changed list
      const positions = new Map<number, number>();
      for (let i = 0; i < ended.length; i++) {
        const t = ended[i]!;
        positions.set(t.identifier, t.clientX);
      }
      const dx1 = (positions.get(activeTouches[0]!.id) ?? activeTouches[0]!.x) - activeTouches[0]!.x;
      const dx2 = (positions.get(activeTouches[1]!.id) ?? activeTouches[1]!.x) - activeTouches[1]!.x;
      const avg = (dx1 + dx2) / 2;
      const THRESHOLD = 60;
      if (avg > THRESHOLD) handlers.onSwipeRight?.();
      else if (avg < -THRESHOLD) handlers.onSwipeLeft?.();
      activeTouches = [];
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [handlers]);
}
