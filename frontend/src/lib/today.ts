import { useEffect, useState } from 'react'
import { todayStr } from '../db/db'

/** Today's date ('YYYY-MM-DD'), kept current: it turns over at midnight with
    the app open, and when the app comes back to the front on a new day (a
    phone that kept it in the background overnight). Screens that read
    todayStr() once on render otherwise kept showing yesterday. */
export function useToday(): string {
  const [day, setDay] = useState(todayStr)
  useEffect(() => {
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      const next = new Date()
      next.setHours(24, 0, 1, 0)
      timer = window.setTimeout(check, next.getTime() - Date.now())
    }
    // timers sleep with the device, so coming back checks as well
    const check = () => { setDay(todayStr()); arm() }
    const onShow = () => { if (document.visibilityState === 'visible') check() }
    arm()
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onShow)
      window.removeEventListener('focus', onShow)
    }
  }, [])
  return day
}
