import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Dialog focus behaviour (HQA-16): focus moves into the dialog when it opens,
// Tab stays inside it, Escape closes it, and focus returns to whatever
// opened it. Attach the returned ref to the dialog element.
export function useModalFocus(onClose) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement
    const node = ref.current
    if (!node) return undefined
    const items = () => [...node.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement)
    const first = node.querySelector('[data-autofocus]') || items().find(el => !el.classList.contains('modal-close-btn')) || items()[0]
    first?.focus()

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const list = items()
      if (!list.length) return
      const head = list[0], tail = list[list.length - 1]
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus() }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus() }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus()
    }
  }, [])

  return ref
}
