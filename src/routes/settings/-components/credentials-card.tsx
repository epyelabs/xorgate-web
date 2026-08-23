import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  CheckCircle2Icon,
  KeyRoundIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { isXorgateError } from "@xorgate/sdk"
import { xgMessage } from "@/lib/xorgate"
import {
  clearOrgCredential,
  listOrgCredentials,
  setOrgCredential,
  validateOrgCredential,
  type CredentialProvider,
  type OrgCredential,
} from "@/lib/org-credentials-api"
import { useWorkspaceStore } from "@/store/workspace"

// One row per key-bearing provider (masked set/rotate/clear + validation),
// plus the informational OSM row. The Claude key row rides the same
// mechanism: it powers VLM Analysis nodes, not the speed-limit connector.

interface ProviderMeta {
  provider: CredentialProvider
  title: string
  description: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: "google_roads",
    title: "Google Roads",
    description:
      "Speed limits for Connector nodes. Best snap-to-road quality; the key's Google project needs the speed-limits (asset tracking) licensing.",
  },
  {
    provider: "here",
    title: "HERE",
    description:
      "Speed limits for Connector nodes via HERE Route Matching. Available on HERE's standard freemium tier.",
  },
  {
    provider: "anthropic",
    title: "Claude API key",
    description:
      "Powers VLM Analysis nodes in workflows. Runs bill to your organization's Anthropic account instead of the platform default.",
  },
]

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatRotated(iso: string | null): string | null {
  if (!iso) return null
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return dateTimeFormat.format(parsed)
}

function errorMessage(err: unknown): string {
  if (isXorgateError(err) && err.status === 403) {
    return "Only organization owners and admins can manage credentials"
  }
  return xgMessage(err)
}

interface RowState {
  input: string
  busy: "save" | "clear" | "validate" | null
  validation: { ok: boolean; message: string; keySource: string } | null
}

const emptyRow: RowState = { input: "", busy: null, validation: null }

function ProviderRow({
  meta,
  credential,
  onChanged,
}: {
  meta: ProviderMeta
  credential: OrgCredential | undefined
  onChanged: () => void
}) {
  const [row, setRow] = useState<RowState>(emptyRow)
  const configured = credential?.configured ?? false
  const rotated = formatRotated(credential?.lastRotatedAt ?? null)

  const patch = (p: Partial<RowState>) => setRow((r) => ({ ...r, ...p }))

  const save = async () => {
    const apiKey = row.input.trim()
    if (!apiKey) return
    patch({ busy: "save", validation: null })
    try {
      await setOrgCredential(meta.provider, apiKey)
      toast.success(`${meta.title} key ${configured ? "rotated" : "saved"}`)
      patch({ input: "", busy: null })
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
      patch({ busy: null })
    }
  }

  const clear = async () => {
    patch({ busy: "clear", validation: null })
    try {
      await clearOrgCredential(meta.provider)
      toast.success(`${meta.title} key cleared; the platform default applies`)
      patch({ input: "", busy: null })
      onChanged()
    } catch (err) {
      toast.error(errorMessage(err))
      patch({ busy: null })
    }
  }

  // Validates the typed candidate key when present, else whatever the engine
  // would use (the stored org key, else the platform default).
  const validate = async () => {
    patch({ busy: "validate", validation: null })
    try {
      const { validation } = await validateOrgCredential(
        meta.provider,
        row.input.trim() || undefined
      )
      patch({ busy: null, validation })
    } catch (err) {
      patch({ busy: null, validation: { ok: false, message: errorMessage(err), keySource: "none" } })
    }
  }

  const sourceLabel: Record<string, string> = {
    candidate: "entered key",
    organization: "organization key",
    platform: "platform default",
    none: "no key",
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <KeyRoundIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{meta.title}</span>
        {configured ? (
          <Badge variant="secondary">Organization key set</Badge>
        ) : (
          <Badge variant="outline">Platform default in use</Badge>
        )}
        {configured && rotated ? (
          <span className="text-xs text-muted-foreground">
            last rotated {rotated}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{meta.description}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          className="sm:max-w-xs"
          placeholder={configured ? "Enter a new key to rotate" : "Enter API key"}
          value={row.input}
          onChange={(e) => patch({ input: e.target.value, validation: null })}
          disabled={row.busy !== null}
        />
        <Button
          size="sm"
          onClick={save}
          disabled={row.busy !== null || row.input.trim().length === 0}
        >
          {row.busy === "save" ? <Loader2Icon className="animate-spin" /> : null}
          {configured ? "Rotate" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={validate}
          disabled={row.busy !== null}
        >
          {row.busy === "validate" ? (
            <Loader2Icon className="animate-spin" />
          ) : null}
          Validate
        </Button>
        {configured ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={clear}
            disabled={row.busy !== null}
          >
            {row.busy === "clear" ? (
              <Loader2Icon className="animate-spin" />
            ) : null}
            Clear
          </Button>
        ) : null}
      </div>
      {row.validation ? (
        <div
          className={`flex items-start gap-1.5 text-xs ${row.validation.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
        >
          {row.validation.ok ? (
            <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <XCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>
            {sourceLabel[row.validation.keySource] ?? row.validation.keySource}:{" "}
            {row.validation.message}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function CredentialsCard() {
  // Keyed by org so switching organizations remounts with fresh state.
  const currentOrganizationId = useWorkspaceStore(
    (s) => s.currentOrganizationId
  )
  return (
    <CredentialsCardBody
      key={currentOrganizationId ?? "none"}
      enabled={currentOrganizationId !== null}
    />
  )
}

function CredentialsCardBody({ enabled }: { enabled: boolean }) {
  const [credentials, setCredentials] = useState<OrgCredential[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    listOrgCredentials()
      .then((res) => {
        setCredentials(res.credentials)
        setLoadError(null)
      })
      .catch((err) => setLoadError(errorMessage(err)))
  }, [])

  useEffect(() => {
    if (!enabled) return
    refresh()
  }, [enabled, refresh])

  const byProvider = new Map(
    (credentials ?? []).map((c) => [c.provider, c] as const)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connector credentials</CardTitle>
        <CardDescription>
          Bring your own API keys for workflow Connector and VLM nodes. Keys
          are write-only: they are stored in AWS Secrets Manager and never
          shown again. Without an organization key, the platform default is
          used where one exists. Rotated or cleared keys can lag on warm
          workflow engines for a few minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : null}
        {PROVIDERS.map((meta, i) => (
          <div key={meta.provider} className="flex flex-col gap-5">
            {i > 0 ? <Separator /> : null}
            <ProviderRow
              meta={meta}
              credential={byProvider.get(meta.provider)}
              onChanged={refresh}
            />
          </div>
        ))}
        <Separator />
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">OpenStreetMap</span>
            <Badge variant="outline">No key required</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The OSM Connector option queries public Overpass servers: no key
            and no bill, but community data coverage varies and lookups are
            throttled to about one per second. Suitable for demos and light
            use.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
