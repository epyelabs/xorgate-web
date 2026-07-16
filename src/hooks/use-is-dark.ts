import { useEffect, useState } from "react"

/**
 * Track whether the app is currently in dark mode by watching the `dark` class
 * the ThemeProvider toggles on <html>. This reflects the RESOLVED theme (so it
 * reacts to both explicit toggles and system changes) without reaching into the
 * provider internals — `useTheme()` reports the setting, which may be "system",
 * not the resolved light/dark that consumers actually need.
 *
 * For anything that can be styled in CSS, prefer Tailwind's `dark:` variant.
 * This is for the cases that cannot: canvas/WebGL scenes, Mapbox styles, and
 * other imperative APIs that need the value in JS.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  )
  useEffect(() => {
    const root = document.documentElement
    const update = () => setIsDark(root.classList.contains("dark"))
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return isDark
}
