import { useEffect, RefObject } from 'react';

/**
 * Hook to handle iOS keyboard by tracking visualViewport changes
 * and dynamically adjusting container height and position.
 */
export function useVisualViewport(containerRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const el = containerRef.current;
      if (!el) return;

      // Set height to actual visible viewport height (accounts for keyboard)
      el.style.height = `${vv.height}px`;

      // Adjust top offset when keyboard is open and page has scrolled
      el.style.top = `${vv.offsetTop}px`;
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [containerRef]);
}
