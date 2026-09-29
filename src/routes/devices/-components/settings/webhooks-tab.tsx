import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CloudIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { isXorgateError } from "@xorgate/sdk"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { CreateWebhookDialog } from "@/components/webhooks/create-webhook-dialog"
import { useHasPermission } from "@/lib/permissions"
import { xg, xgMessage } from "@/lib/xorgate"
import {
  DEVICE_WEBHOOK_EVENT_GROUPS,
  DEVICE_WEBHOOK_EVENT_TYPES,
  type DeviceWebhookEventType,
  type DeviceWebhookRoute,
} from "@/lib/webhooks-api"
import { qk } from "@/queries/keys"
import { useTenant } from "@/queries/tenant"
import { useDeviceWebhooks, useWebhookEndpoints } from "@/queries/webhooks"
import { SettingsCallout } from "./callout"

const NEW = "__new__"

const EVENT_LABEL: Record<DeviceWebhookEventType, string> = Object.fromEntries(
  DEVICE_WEBHOOK_EVENT_GROUPS.flatMap((g) =>
    g.types.map((t) => [t.type, `${g.label.replace(/s$/, "")} ${t.label.toLowerCase()}`])
  )
) as Record<DeviceWebhookEventType, string>

// The order the API and the chips use, whatever order boxes were ticked in.
const byCatalogOrder = (types: DeviceWebhookEventType[]) =>
  DEVICE_WEBHOOK_EVENT_TYPES.filter((t) => types.includes(t))

type RouteSet = { endpointId: string; eventTypes: DeviceWebhookEventType[] }[]

/**
 * Device Settings -> Webhooks (plans/xorgate-webhooks D1): which endpoints get
 * this device's presence and session events. Cloud-side routing stored in
 * `webhook_routes`, NOT part of the device config revision, so nothing here
 * syncs to the device or waits for it to be online. Every save PUTs the whole
 * set. Owners and admins write; members read; viewers are refused by the API.
 */
export function WebhooksTab({ deviceId }: { deviceId: string }) {
  const canManage = useHasPermission("webhooks:manage")
  const routesQuery = useDeviceWebhooks(deviceId)
  const endpointsQuery = useWebhookEndpoints()
  const queryClient = useQueryClient()
  const { orgId, wsId } = useTenant()
  const [editing, setEditing] = useState<DeviceWebhookRoute | "new" | null>(null)
  const [saving, setSaving] = useState(false)

  const routes = routesQuery.data ?? []
  const endpointsById = new Map(
    (endpointsQuery.data?.items ?? []).map((e) => [e.id, e])
  )

  async function save(next: RouteSet, message: string): Promise<boolean> {
    setSaving(true)
    try {
      const res = await xg().devices.webhooks.set(deviceId, next)
      queryClient.setQueryData(qk.deviceWebhooks(orgId, wsId, deviceId), res)
      toast.success(message)
      return true
    } catch (err) {
      toast.error(xgMessage(err))
      return false
    } finally {
      setSaving(false)
    }
  }

  const current = (): RouteSet =>
    routes.map((r) => ({ endpointId: r.endpointId, eventTypes: r.eventTypes }))

  async function upsert(route: RouteSet[number]): Promise<boolean> {
    const rest = current().filter((r) => r.endpointId !== route.endpointId)
    const replaced = rest.length !== routes.length
    return save(
      [...rest, { ...route, eventTypes: byCatalogOrder(route.eventTypes) }],
      replaced ? "Route updated" : "Route added"
    )
  }

  async function remove(route: DeviceWebhookRoute) {
    await save(
      current().filter((r) => r.endpointId !== route.endpointId),
      `Route to ${route.endpointName} removed`
    )
  }

  const forbidden =
    routesQuery.error &&
    isXorgateError(routesQuery.error) &&
    routesQuery.error.status === 403

  return (
    <div className="flex w-full flex-col gap-4" data-testid="device-webhooks-tab">
      <SettingsCallout icon={<CloudIcon />}>
        Cloud-side routing. These settings live on the platform and are not
        synced to the device: they apply at once, online or not, to events
        from now on (no backfill). Workflow events are routed from the
        template's Event node instead.
      </SettingsCallout>

      <Card>
        <CardHeader>
          <CardTitle>Webhook routes</CardTitle>
          <CardDescription>
            Which{" "}
            <Link to="/webhooks" className="underline underline-offset-2">
              webhook endpoints
            </Link>{" "}
            receive this device's presence and session events.
          </CardDescription>
          {canManage ? (
            <CardAction>
              <Button
                size="sm"
                onClick={() => setEditing("new")}
                disabled={routesQuery.isPending || !!forbidden}
                data-testid="add-webhook-route"
              >
                <PlusIcon />
                Add route
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {routesQuery.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : forbidden ? (
            <p className="text-sm text-muted-foreground">
              Owners, admins and members can see this device's webhook routes.
            </p>
          ) : routesQuery.error ? (
            <p className="text-sm text-destructive">{xgMessage(routesQuery.error)}</p>
          ) : routes.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No routes. This device's events are recorded but delivered
              nowhere.
            </p>
          ) : (
            routes.map((route) => {
              const ep = endpointsById.get(route.endpointId)
              return (
                <div
                  key={route.endpointId}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                  data-testid={`webhook-route-${route.endpointName}`}
                >
                  <Link
                    to="/webhooks/$id"
                    params={{ id: route.endpointId }}
                    className="font-mono text-sm font-medium hover:underline"
                  >
                    {route.endpointName}
                  </Link>
                  {ep && !ep.enabled ? (
                    <Badge variant="destructive">disabled</Badge>
                  ) : null}
                  <span className="text-muted-foreground">←</span>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {byCatalogOrder(route.eventTypes).map((t) => (
                      <Badge key={t} variant="secondary" className="font-mono text-[10px]" title={EVENT_LABEL[t]}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                  {canManage ? (
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Edit route to ${route.endpointName}`}
                        onClick={() => setEditing(route)}
                        disabled={saving}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Remove route to ${route.endpointName}`}
                        onClick={() => void remove(route)}
                        disabled={saving}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <RouteDialog
        editing={editing}
        onClose={() => setEditing(null)}
        routedEndpointIds={new Set(routes.map((r) => r.endpointId))}
        saving={saving}
        onSave={upsert}
      />
    </div>
  )
}

function RouteDialog({
  editing,
  onClose,
  routedEndpointIds,
  saving,
  onSave,
}: {
  editing: DeviceWebhookRoute | "new" | null
  onClose: () => void
  routedEndpointIds: Set<string>
  saving: boolean
  onSave: (route: RouteSet[number]) => Promise<boolean>
}) {
  const endpointsQuery = useWebhookEndpoints()
  const endpoints = endpointsQuery.data?.items ?? []
  const [endpointId, setEndpointId] = useState("")
  const [types, setTypes] = useState<DeviceWebhookEventType[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const isNew = editing === "new"
  const open = editing !== null

  // Seed as the dialog opens (adjusted during render): an edit starts from
  // the route, "new" from an empty pick.
  const [seen, setSeen] = useState(editing)
  if (editing !== seen) {
    setSeen(editing)
    if (editing !== null) {
      setEndpointId(editing === "new" ? "" : editing.endpointId)
      setTypes(editing === "new" ? [] : editing.eventTypes)
    }
  }

  const choices = isNew
    ? endpoints.filter((e) => !routedEndpointIds.has(e.id))
    : endpoints.filter((e) => e.id === endpointId)

  const toggle = (t: DeviceWebhookEventType, on: boolean) =>
    setTypes((prev) => (on ? [...prev.filter((x) => x !== t), t] : prev.filter((x) => x !== t)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!endpointId || types.length === 0) return
    if (await onSave({ endpointId, eventTypes: types })) onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (!o && !saving ? onClose() : undefined)}>
        <DialogContent className="sm:max-w-md" data-testid="webhook-route-dialog">
          <DialogHeader>
            <DialogTitle>{isNew ? "Add webhook route" : "Edit webhook route"}</DialogTitle>
            <DialogDescription>
              Pick an endpoint and the events it should receive from this device.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="route-endpoint">Endpoint</FieldLabel>
                <Select
                  value={endpointId}
                  onValueChange={(v) => (v === NEW ? setCreateOpen(true) : setEndpointId(v))}
                  disabled={!isNew}
                >
                  <SelectTrigger id="route-endpoint" data-testid="route-endpoint-select">
                    <SelectValue
                      placeholder={endpointsQuery.isPending ? "Loading endpoints…" : "Pick an endpoint"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((ep) => (
                      <SelectItem key={ep.id} value={ep.id} data-testid={`route-endpoint-option-${ep.name}`}>
                        <span className="font-mono text-xs">{ep.name}</span>
                        {!ep.enabled ? <span className="ml-1 text-muted-foreground">(disabled)</span> : null}
                      </SelectItem>
                    ))}
                    {isNew ? (
                      <>
                        {choices.length > 0 ? (
                          <div role="separator" className="-mx-1 my-1 h-px bg-border" />
                        ) : null}
                        <SelectItem value={NEW}>+ New endpoint…</SelectItem>
                      </>
                    ) : null}
                  </SelectContent>
                </Select>
              </Field>
              {DEVICE_WEBHOOK_EVENT_GROUPS.map((group) => (
                <fieldset key={group.label} className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-xs font-medium">{group.label}</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {group.types.map(({ type, label }) => (
                      <label
                        key={type}
                        className="flex cursor-pointer items-center gap-1.5 text-sm"
                        title={type}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 cursor-pointer accent-primary"
                          checked={types.includes(type)}
                          onChange={(e) => toggle(type, e.target.checked)}
                          data-testid={`route-event-${type}`}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !endpointId || types.length === 0}>
                {saving ? "Saving..." : "Save route"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <CreateWebhookDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(ep) => setEndpointId(ep.id)}
      />
    </>
  )
}
