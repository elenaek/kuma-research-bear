import { useRef, useEffect, useCallback } from 'preact/hooks';

/**
 * useDebounce - Custom hook for debouncing function calls
 *
 * Delays the execution of a function until after a specified delay
 * has elapsed since the last time it was invoked.
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns Debounced version of the callback function
 *
 * @example
 * const debouncedSearch = useDebounce((query: string) => {
 *   performSearch(query);
 * }, 300);
 *
 * // In component:
 * <input onChange={(e) => debouncedSearch(e.target.value)} />
 */
export function useDebounce<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedCallback = useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    }) as T,
    [callback, delay]
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}
