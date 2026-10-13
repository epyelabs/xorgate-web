import { useEffect, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { requireWorkspace } from "@/lib/auth-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AppErrorScreen, NotFoundScreen } from "@/components/error-screens"
import { xg } from "@/lib/xorgate"
import type { DeviceIdentity, VideoChannel } from "@xorgate/sdk"
import {
  SETTINGS_TABS,
  SETTINGS_TAB_LABELS,
  type SettingsTab,
} from "@/lib/device-settings-tabs"
import { tabAttentionCounts } from "@/lib/device-config-status"
import { Badge } from "@/components/ui/badge"
import { useDeviceSettings } from "@/hooks/use-device-settings"
import { useLiveTelemetry } from "@xorgate/react"
import { ConnectivityTab } from "./-components/settings/connectivity-tab"
import { GeneralTab } from "./-components/settings/general-tab"
import { InterfaceTab } from "./-components/settings/interface-tab"
import { MediaTab } from "./-components/settings/media-tab"
import { PowerTab } from "./-components/settings/power-tab"
import { SystemTab } from "./-components/settings/system-tab"
import { TelemetryTab } from "./-components/settings/telemetry-tab"
import { PeripheralsTab } from "./-components/settings/peripherals-tab"
import { WebhooksTab } from "./-components/settings/webhooks-tab"

// The active sub-tab lives in the URL so a specific settings group is
// linkable/bookmarkable and Back restores it (same dialect as the Media tab's
// filters). The default is encoded as an ABSENT param, keeping the common URL
// clean.
export const Route = createFileRoute("/devices/$id/settings")({
  beforeLoad: requireWorkspace,
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => ({
    tab: SETTINGS_TABS.includes(search.tab as SettingsTab)
      ? (search.tab as SettingsTab)
      : undefined,
  }),
  component: DeviceSettingsPage,
})

const DEFAULT_TAB: SettingsTab = "general"

function DeviceSettingsPage() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const activeTab = tab ?? DEFAULT_TAB

  const {
    device,
    recording,
    configStatus,
    error,
    notFound,
    isPending,
    commit,
    commitRecording,
    refreshReport,
    refreshing,
    pollReport,
    updateAgent,
    updatingAgent,
  } = useDeviceSettings(id)

  // Pending/queued/rejected namespaces, counted per tab (Phase 3). The point is
  // the tab the operator ISN'T looking at: `recording` spans four of them, so a
  // value the device refused on the Media tab is visible from Power too.
  const attention = tabAttentionCounts(configStatus)

  // Live payload feed: the reported-state strip on Media and the SoC
  // temperature shown beside the thermal threshold on Power. Fetched once here
  // rather than per-tab so switching tabs doesn't churn the MQTT feed.
  const {
    recording: reportedRecording,
    media: reportedMedia,
    latest,
  } = useLiveTelemetry(id)
  const cpuTemp = latest["system.cpu_temp"]?.value ?? null

  // Read-only sections, fetched independently so a failure here never blocks
  // the form. Channels drive the per-camera switches as well as the table.
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null)
  const [identityLoaded, setIdentityLoaded] = useState(false)
  const [channels, setChannels] = useState<VideoChannel[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fetched = await xg().devices.identity(id)
        if (!cancelled) setIdentity(fetched)
      } catch {
        // Identity is best-effort metadata; leave it null on failure.
      } finally {
        if (!cancelled) setIdentityLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fetched = await xg().devices.videoChannels(id)
        if (!cancelled) setChannels(fetched)
      } catch {
        if (!cancelled) setChannels([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (notFound) return <NotFoundScreen />
  if (device === null && error !== null) {
    return <AppErrorScreen error={error} />
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({
            search: {
              // Default encoded as absent, per validateSearch above.
              tab: v === DEFAULT_TAB ? undefined : (v as SettingsTab),
            },
          })
        }
        className="gap-4"
      >
        {/* Segmented (default) variant, deliberately NOT `line`: the device tab
            bar directly above is a line tab bar, and a second underlined row
            under it reads as one confused hierarchy.
            The list still scrolls on a narrow viewport, but its scrollbar is
            hidden: an always-visible track inside a 2rem pill reads as a
            rendering artifact, and it eats into the pill's height. */}
        <TabsList className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SETTINGS_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {SETTINGS_TAB_LABELS[t]}
              {attention[t] ? (
                <Badge variant="secondary" className="ml-1.5 px-1.5">
                  {attention[t]}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {device === null ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <TabsContent value="general">
              <GeneralTab
                device={device}
                identity={identity}
                identityLoaded={identityLoaded}
                configStatus={configStatus}
                isPending={isPending}
                commit={commit}
                updateAgent={updateAgent}
                updatingAgent={updatingAgent}
              />
            </TabsContent>
            <TabsContent value="interface">
              <InterfaceTab
                device={device}
                isPending={isPending}
                commit={commit}
              />
            </TabsContent>
            <TabsContent value="telemetry">
              <TelemetryTab
                device={device}
                recording={recording}
                configStatus={configStatus}
                isPending={isPending}
                commit={commit}
                commitRecording={commitRecording}
              />
            </TabsContent>
            <TabsContent value="media">
              <MediaTab
                device={device}
                recording={recording}
                configStatus={configStatus}
                channels={channels}
                reportedRecording={reportedRecording}
                reportedMedia={reportedMedia}
                isPending={isPending}
                commit={commit}
                commitRecording={commitRecording}
              />
            </TabsContent>
            <TabsContent value="connectivity">
              <ConnectivityTab
                device={device}
                configStatus={configStatus}
                isPending={isPending}
                commit={commit}
                refreshReport={refreshReport}
                refreshing={refreshing}
              />
            </TabsContent>
            <TabsContent value="peripherals">
              <PeripheralsTab
                device={device}
                configStatus={configStatus}
                isPending={isPending}
                commit={commit}
                pollReport={pollReport}
                refreshReport={refreshReport}
                refreshing={refreshing}
              />
            </TabsContent>
            <TabsContent value="power">
              <PowerTab
                recording={recording}
                cpuTemp={cpuTemp}
                configStatus={configStatus}
                isPending={isPending}
                commitRecording={commitRecording}
              />
            </TabsContent>
            <TabsContent value="system">
              <SystemTab
                device={device}
                recording={recording}
                configStatus={configStatus}
                isPending={isPending}
                commit={commit}
                commitRecording={commitRecording}
              />
            </TabsContent>
            <TabsContent value="webhooks">
              <WebhooksTab deviceId={id} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
