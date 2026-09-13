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

// One-way boot latch for the root layout: flips once the router has gone idle
// with no workspace fetch in flight, and never flips back, so later
// navigations and org switches never blank the whole app again. Lives here
// beside the shell-mounted flag because the root layout is a singleton and the
// react-hooks rules refuse both a ref read and a module-variable write during
// render; a function call is the sanctioned shape.
let bootSettled = false

export function markBootSettled(): void {
  bootSettled = true
}

export function hasBootSettled(): boolean {
  return bootSettled
}
