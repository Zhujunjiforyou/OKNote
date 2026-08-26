import { useEffect, useState } from 'react'
import { getLocalDateKey } from '@/lib/utils'

function millisecondsUntilNextDay() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 150)
  return Math.max(250, next.getTime() - now.getTime())
}

export function useCurrentDateKey() {
  const [dateKey, setDateKey] = useState(getLocalDateKey)

  useEffect(() => {
    let timer = 0
    const refresh = () => {
      setDateKey(getLocalDateKey())
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, millisecondsUntilNextDay())
    }
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    timer = window.setTimeout(refresh, millisecondsUntilNextDay())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenActive)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenActive)
    }
  }, [])

  return dateKey
}
