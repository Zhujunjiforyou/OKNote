import { useSyncExternalStore } from 'react'
import { getLocalDateKey } from '@/lib/utils'

function millisecondsUntilNextDay() {
  const now = new Date()
  const next = new Date(now)
  next.setHours(24, 0, 0, 150)
  return Math.max(250, next.getTime() - now.getTime())
}

// All task rows share one clock, including large notes with hundreds of items.
const subscribers = new Set<() => void>()
let timer = 0
function refresh() {
  subscribers.forEach((subscriber) => subscriber())
  window.clearTimeout(timer)
  timer = window.setTimeout(refresh, millisecondsUntilNextDay())
}
function refreshWhenActive() { if (document.visibilityState === 'visible') refresh() }
function subscribe(callback: () => void) {
  subscribers.add(callback)
  if (subscribers.size === 1) {
    timer = window.setTimeout(refresh, millisecondsUntilNextDay())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenActive)
  }
  return () => {
    subscribers.delete(callback)
    if (!subscribers.size) {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenActive)
    }
  }
}
export function useCurrentDateKey() {
  return useSyncExternalStore(subscribe, getLocalDateKey, getLocalDateKey)
}
