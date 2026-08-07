// Which pages a user has to be pulled off of when the active organization or
// workspace changes.
//
// Only *detail* pages are stranded by a switch: they address one resource by id
// in the URL, and that resource belongs to the context being left, so after the
// switch they would 404 or — worse — keep rendering the previous context's data.
// Everything else (list pages, and the organization-level singletons like
// Members or Billing) is scoped by the request headers rather than the URL, so
// it simply refetches under the new context and the user should stay put.
const WORKSPACE_SCOPED_DETAIL = [
  /^\/devices\/[^/]+/,
  /^\/workflow-instances\/[^/]+/,
]

const ORGANIZATION_SCOPED_DETAIL = [/^\/workflow-templates\/[^/]+/]

export type ContextScope = "workspace" | "organization"

export function shouldLeaveOnContextSwitch(
  pathname: string,
  scope: ContextScope
): boolean {
  // Switching organization switches the active workspace along with it, so an
  // organization switch strands workspace-scoped pages too — not just the
  // organization-scoped ones.
  const patterns =
    scope === "organization"
      ? [...WORKSPACE_SCOPED_DETAIL, ...ORGANIZATION_SCOPED_DETAIL]
      : WORKSPACE_SCOPED_DETAIL
  return patterns.some((pattern) => pattern.test(pathname))
}
