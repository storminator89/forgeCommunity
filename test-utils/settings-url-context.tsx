import { useEffect, useState, type ReactNode } from 'react'
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'

// Supply the real Next hook's context and mimic the App Router's documented
// native-history integration. Back/Forward uses actual JSDOM popstate events.
export function SettingsUrlContext({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState(window.location.search)
  useEffect(() => {
    const update = () => setQuery(window.location.search)
    const push = window.history.pushState.bind(window.history)
    const pushSpy = jest.spyOn(window.history, 'pushState').mockImplementation((...args) => {
      push(...args)
      update()
    })
    window.addEventListener('popstate', update)
    return () => {
      pushSpy.mockRestore()
      window.removeEventListener('popstate', update)
    }
  }, [])
  return <SearchParamsContext.Provider value={new URLSearchParams(query)}>{children}</SearchParamsContext.Provider>
}
