import { useEffect, useState, type ReactNode } from 'react';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

// Use the installed Next hook and emulate its documented native-history
// integration. Actual JSDOM Back/Forward supplies popstate events.
export function SearchUrlContext({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState(window.location.search);
  useEffect(() => {
    const update = () => setQuery(window.location.search);
    const push = window.history.pushState.bind(window.history);
    const replace = window.history.replaceState.bind(window.history);
    const pushSpy = jest.spyOn(window.history, 'pushState').mockImplementation((...args) => { push(...args); update(); });
    const replaceSpy = jest.spyOn(window.history, 'replaceState').mockImplementation((...args) => { replace(...args); update(); });
    window.addEventListener('popstate', update);
    return () => {
      pushSpy.mockRestore();
      replaceSpy.mockRestore();
      window.removeEventListener('popstate', update);
    };
  }, []);
  return <SearchParamsContext.Provider value={new URLSearchParams(query)}>{children}</SearchParamsContext.Provider>;
}
