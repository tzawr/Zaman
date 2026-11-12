import { useEffect } from 'react'

// While `active`, leaving the page asks first: closing or reloading the tab
// (the browser's own prompt) and following any link on the page. The app
// uses <BrowserRouter>, which has no navigation blocker, so links are caught
// in the capture phase before the router sees them. Buttons that navigate
// should ask themselves with the same message.
export function useUnsavedChangesWarning(active, message) {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, message])
}
