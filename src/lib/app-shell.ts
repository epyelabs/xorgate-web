// One-way latch: has the app shell (sidebar + header) rendered at least once?
//
// The router's pending component renders wherever the chrome already is. Before
// boot settles that is the whole viewport, and the full-screen brand hold is
// exactly right. Afterwards it is the shell's content area, where a full-screen
// hold reads as the page blinking on every navigation — sidebar still up,
// content replaced by a centred logo. So the brand hold stays an OUTER wrapper
// only, and route transitions past boot get a quiet inline hold instead.
//
// A module flag rather than state: nothing needs to re-render when it flips, it
// is only ever read by a pending component that mounts after the fact.
let shellMounted = false

export function markAppShellMounted(): void {
  shellMounted = true
}

export function hasAppShellMounted(): boolean {
  return shellMounted
}
