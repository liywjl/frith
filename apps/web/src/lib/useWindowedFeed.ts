import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

const PAGE = 60;

/**
 * Windowed message feed: render only the newest PAGE messages and reveal
 * older ones as the reader scrolls toward the top, keeping the viewport
 * anchored so history doesn't jump. Stays pinned to the bottom for new
 * messages only while the reader is already there — never yanks someone
 * out of the archive. Chat history is a suffix you rarely leave, so a
 * slice beats a virtualization library here.
 */
export function useWindowedFeed<T>(feedRef: RefObject<HTMLDivElement | null>, items: T[], resetKey: string) {
  const [count, setCount] = useState(PAGE);
  const pinned = useRef(true);
  /** Scroll geometry recorded just before older items mount, to re-anchor. */
  const anchor = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    setCount(PAGE);
    pinned.current = true;
  }, [resetKey]);

  const visible = items.length > count ? items.slice(items.length - count) : items;
  const hiddenCount = items.length - visible.length;

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200 && hiddenCount > 0 && !anchor.current) {
      anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      setCount((c) => c + PAGE);
    }
  };

  // Older messages just mounted above the viewport — put the reader back on
  // the message they were looking at.
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && anchor.current) {
      el.scrollTop = anchor.current.top + (el.scrollHeight - anchor.current.height);
      anchor.current = null;
    }
  }, [count, feedRef]);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, resetKey, feedRef]);

  return { visible, hiddenCount, onScroll };
}
