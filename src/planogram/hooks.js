import { useEffect, useRef, useState } from 'react';

export function useDebounced(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  const tRef = useRef(null);
  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setDebounced(value), delay);
    return () => { if (tRef.current) window.clearTimeout(tRef.current); };
  }, [value, delay]);
  return debounced;
}

