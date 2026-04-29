import { useEffect, useRef, useState } from 'react'

export function useSpeechInput(onText) {
  const recognitionRef = useRef(null)
  const [listening, setListening] = useState(false)
  const [supported] = useState(() => {
    if (typeof window === 'undefined') return false
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  })

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .slice(event.resultIndex)
        .map(result => result[0]?.transcript || '')
        .join(' ')
        .trim()
      if (text) onText(text)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition

    return () => recognition.stop()
  }, [onText])

  function toggleListening() {
    const recognition = recognitionRef.current
    if (!recognition) return
    if (listening) {
      recognition.stop()
      setListening(false)
    } else {
      recognition.start()
      setListening(true)
    }
  }

  return { listening, supported, toggleListening }
}
