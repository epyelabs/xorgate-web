import { useState } from "react"
import { RocketIcon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  type FunctionConfig,
  type FunctionVersion,
} from "@/lib/code-function-runtime"
import { useWorkflowEditor } from "@/store/workflow-editor"

// Lambda-style versioning for a single function, stored in the node's config
// jsonb (`versions`, newest first, plus `deployedVersion`). Deploying
// snapshots the current $LATEST code and marks it live; restore copies a
// snapshot back into $LATEST for further editing. Persisted through the
// template's normal draft-save flow — no extra backend surface needed for
// the mockup.

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function VersionsTab({ nodeId, fn }: { nodeId: string; fn: FunctionConfig }) {
  const updateNodeConfig = useWorkflowEditor((s) => s.updateNodeConfig)
  const [description, setDescription] = useState("")

  const latestPublished = fn.versions[0]
  const hasUnpublishedChanges = !latestPublished || latestPublished.code !== fn.code

  const handleDeploy = () => {
    const nextVersion = (latestPublished?.version ?? 0) + 1
    const snapshot: FunctionVersion = {
      version: nextVersion,
      code: fn.code,
      handler: fn.handler,
      publishedAt: new Date().toISOString(),
      ...(description.trim() ? { description: description.trim() } : {}),
    }
    updateNodeConfig(nodeId, "versions", [snapshot, ...fn.versions])
    updateNodeConfig(nodeId, "deployedVersion", nextVersion)
    setDescription("")
    toast.success(`Deployed v${nextVersion}`)
  }

  const handleRestore = (version: FunctionVersion) => {
    updateNodeConfig(nodeId, "code", version.code)
    updateNodeConfig(nodeId, "handler", version.handler)
    toast.success(`v${version.version} restored to $LATEST`)
  }

  const handleSetLive = (version: FunctionVersion) => {
    updateNodeConfig(nodeId, "deployedVersion", version.version)
    toast.success(`v${version.version} is now live`)
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      {/* Deploy the working copy */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="flex min-w-40 flex-col">
          <span className="text-xs font-medium">$LATEST (working copy)</span>
          <span className="text-[11px] text-muted-foreground">
            {hasUnpublishedChanges
              ? "Has changes not in any published version"
              : `Identical to v${latestPublished.version}`}
          </span>
        </div>
        <Input
          className="h-7 min-w-48 flex-1"
          placeholder="Version description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button size="sm" onClick={handleDeploy} disabled={!hasUnpublishedChanges}>
          <RocketIcon />
          Deploy new version
        </Button>
      </div>

      {fn.versions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">
          No published versions yet. Deploying snapshots the current code as an
          immutable v1 and marks it live.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {fn.versions.map((version) => {
            const live = fn.deployedVersion === version.version
            return (
              <li
                key={version.version}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <Badge variant={live ? "default" : "outline"}>v{version.version}</Badge>
                {live ? (
                  <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    Live
                  </Badge>
                ) : null}
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs">
                    {version.description ?? "No description"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {dateFmt.format(new Date(version.publishedAt))} · handler{" "}
                    <code>{version.handler}</code> · {version.code.length.toLocaleString()}{" "}
                    chars
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  {!live ? (
                    <Button variant="outline" size="sm" onClick={() => handleSetLive(version)}>
                      Set live
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={() => handleRestore(version)}>
                    <RotateCcwIcon />
                    Restore to $LATEST
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
