import { useEffect, useState } from 'react';

// ponytail: static fallback is just UTC; real list fills in after mount, so
// the SSR-rendered <option> set always matches the client's first paint.
const FALLBACK_TIMEZONES = ['UTC'];

export function useTimezones() {
  const [timezones, setTimezones] = useState(FALLBACK_TIMEZONES);

  useEffect(() => {
    if (typeof Intl.supportedValuesOf === 'function') {
      setTimezones(Intl.supportedValuesOf('timeZone'));
    }
  }, []);

  return timezones;
}
