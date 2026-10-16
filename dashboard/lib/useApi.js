'use client';
import { useCallback, useEffect, useState } from 'react';

// One place for "load it, show a spinner, show the error, let the person try again": pages used to write this
// useState/useEffect/.catch/.finally block by hand (37 of them), each a little different. Session expiry and timeouts are
// already handled for every call in lib/api.js.
//   const { data: leads, error, loading, reload } = useApi(() => platformApi.listLeads(), [], []);
// fetcher runs on mount and again whenever one of `deps` changes; reload() runs it by hand. `initial` is what `data` holds before the first answer.
export function useApi(fetcher, deps = [], initial = null) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetcher().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
