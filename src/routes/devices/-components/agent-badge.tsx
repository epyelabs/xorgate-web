import { Badge } from "@/components/ui/badge"
import type { ReportedAgentKind } from "@xorgate/sdk"
import { agentLabel } from "@/lib/device-agent"
import { cn } from "@/lib/utils"

/**
 * Which device agent a device runs: JS or Rust (dual-agent registration D6.4).
 * A value newer than this console is shown as-is rather than relabelled.
 */
export function AgentBadge({
  agent,
  className,
}: {
  agent: ReportedAgentKind
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      data-testid="device-agent-badge"
      data-agent={agent}
      title={
        agent === "rust"
          ? "Runs the native Rust device agent"
          : agent === "js"
            ? "Runs the JS (Node) device agent"
            : `Runs the "${agent}" device agent`
      }
      className={cn(
        agent === "rust" &&
          "border-orange-500/50 text-orange-600 dark:text-orange-400",
        className
      )}
    >
      {agentLabel(agent)}
    </Badge>
  )
}
