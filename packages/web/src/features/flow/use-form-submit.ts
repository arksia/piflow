import { useEffect, useRef, useState } from 'react'

export function useFormSubmit(onSuccess: () => void) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function submit(action: () => Promise<void>) {
    if (submittingRef.current)
      return
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await action()
      if (mountedRef.current)
        onSuccess()
    }
    catch (reason) {
      if (mountedRef.current)
        setError(reason instanceof Error ? reason.message : String(reason))
    }
    finally {
      submittingRef.current = false
      if (mountedRef.current)
        setSubmitting(false)
    }
  }
  return { submitting, error, submit }
}
