import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { TriangleAlertIcon } from "lucide-react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CreateWebhookDialog } from "@/components/webhooks/create-webhook-dialog"
import { useHasPermission } from "@/lib/permissions"
import { useWebhookEndpoints } from "@/queries/webhooks"

const NONE = "__none__"
const NEW = "__new__"

// The `webhook` field of an output.event node (engine 0.5.0, plans/xorgate-
// webhooks D1): a select of the organization's endpoint NAMES, "None", and
// "+ New endpoint" (the registry's create dialog, which then selects the new
// name). The config stores the name, never a URL or secret, so the template
// stays portable: imported into another organization, `dispatch` binds to
// that organization's own `dispatch`. A name with no endpoint here keeps its
// value (publish still succeeds; the platform records the events as unrouted)
// and shows a warning.
export function EndpointRefField({
  fieldId,
  value,
  description,
  setValue,
}: {
  fieldId: string
  value: unknown
  description?: string
  setValue: (v: unknown) => void
}) {
  const endpointsQuery = useWebhookEndpoints()
  const endpoints = endpointsQuery.data?.webhooks ?? []
  const canManage = useHasPermission("webhooks:manage")
  const [createOpen, setCreateOpen] = useState(false)

  const name = typeof value === "string" && value.trim() !== "" ? value.trim() : null
  const bound = name === null || endpoints.some((e) => e.name === name)
  const unbound = name !== null && !bound && endpointsQuery.isSuccess
  const disabled = endpoints.find((e) => e.name === name && !e.enabled)

  const choose = (v: string) => {
    if (v === NEW) {
      setCreateOpen(true)
      return
    }
    setValue(v === NONE ? undefined : v)
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="endpoint-ref-field">
      <Label htmlFor={fieldId} className="flex items-center gap-1 text-xs">
        Webhook
        {unbound ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <TriangleAlertIcon
                className="size-3.5 text-amber-600 dark:text-amber-500"
                aria-label="No endpoint with this name"
                data-testid="endpoint-ref-unbound"
              />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              This organization has no endpoint named "{name}". Publishing still
              works; production events from this node are recorded as unrouted
              until an endpoint with this name exists.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </Label>
      <Select value={name ?? NONE} onValueChange={choose}>
        <SelectTrigger id={fieldId} data-testid="endpoint-ref-select">
          <SelectValue
            placeholder={endpointsQuery.isPending ? "Loading endpoints…" : "None"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            <span className="text-muted-foreground">None (do not deliver)</span>
          </SelectItem>
          {endpoints.map((e) => (
            <SelectItem
              key={e.id}
              value={e.name}
              data-testid={`endpoint-ref-option-${e.name}`}
            >
              <span className="font-mono text-xs">{e.name}</span>
              {!e.enabled ? (
                <span className="ml-1 text-muted-foreground">(disabled)</span>
              ) : null}
            </SelectItem>
          ))}
          {name !== null && !bound ? (
            // Keep an unbound stored name selectable so the trigger shows it.
            <SelectItem value={name}>
              <span className="font-mono text-xs">{name}</span>
              <span className="ml-1 text-amber-600 dark:text-amber-500">
                (no such endpoint)
              </span>
            </SelectItem>
          ) : null}
          {canManage ? (
            <>
              <div role="separator" className="-mx-1 my-1 h-px bg-border" />
              <SelectItem value={NEW} data-testid="endpoint-ref-new">
                + New endpoint…
              </SelectItem>
            </>
          ) : null}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {description ?? "Endpoint name to deliver each event to"}. Production
        runs only, once the run ends; simulations show where they would go.{" "}
        <Link to="/webhooks" className="underline underline-offset-2">
          Manage endpoints
        </Link>
      </p>
      {disabled ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          "{disabled.name}" is disabled: nothing is delivered until it is enabled.
        </p>
      ) : null}
      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialName={name !== null && !bound ? name : ""}
        onCreated={(ep) => setValue(ep.name)}
      />
    </div>
  )
}
