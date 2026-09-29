import { create } from "zustand"

// Lets detail pages publish the fetched entity's display name so the root
// layout breadcrumb can render "Home > Devices > DEVICE_NAME" (or the workflow
// template equivalent) without refetching.
interface BreadcrumbState {
  deviceName: string | null
  setDeviceName: (deviceName: string | null) => void
  templateName: string | null
  setTemplateName: (templateName: string | null) => void
  instanceName: string | null
  setInstanceName: (instanceName: string | null) => void
  // Models section: the dataset, job and registry model names for the crumb.
  datasetName: string | null
  setDatasetName: (datasetName: string | null) => void
  jobName: string | null
  setJobName: (jobName: string | null) => void
  modelName: string | null
  setModelName: (modelName: string | null) => void
  // The webhook endpoint detail page's crumb.
  webhookName: string | null
  setWebhookName: (webhookName: string | null) => void
}

export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  deviceName: null,
  setDeviceName: (deviceName) => set({ deviceName }),
  templateName: null,
  setTemplateName: (templateName) => set({ templateName }),
  instanceName: null,
  setInstanceName: (instanceName) => set({ instanceName }),
  datasetName: null,
  setDatasetName: (datasetName) => set({ datasetName }),
  jobName: null,
  setJobName: (jobName) => set({ jobName }),
  modelName: null,
  setModelName: (modelName) => set({ modelName }),
  webhookName: null,
  setWebhookName: (webhookName) => set({ webhookName }),
}))
