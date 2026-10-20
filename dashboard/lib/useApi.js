'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// One place for "load it, show a spinner, show the error, let the person try again": pages used to write this
// useState/useEffect/.catch/.finally block by hand (37 of them), each a little different. Session expiry and timeouts are
// already handled for every call in lib/api.js.
//   const { data: leads, error, loading, reload } = useApi(() => platformApi.listLeads(), [], []);
// fetcher runs on mount and again whenever one of `deps` changes; reload() runs it by hand. `initial` is what `data` holds before the first answer.
// Only the newest request counts: a slow answer to an older one (a quick tab switch, typing in a search box) is dropped.
export function useApi(fetcher, deps = [], initial = null) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    const current = () => mine === latest.current;
    setLoading(true);
    setError(null);
    return fetcher()
      .then((d) => { if (current()) setData(d); })
      .catch((e) => { if (current()) setError(e.message); })
      .finally(() => { if (current()) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
