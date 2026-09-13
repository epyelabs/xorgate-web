import {
  BoxesIcon,
  HardDriveIcon,
  ImagesIcon,
  PlayIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"

import type { SearchResultType } from "./search-api"

// The single place the global search knows about a resource kind: its group
// heading and icon in the palette. Order here is the order groups appear.
//
// Adding a new searchable resource is three localized changes:
//   1. a query block in the backend handler (xorgate-core-service/src/handlers/search.ts)
//   2. an entry in this array
//   3. a case in navigateToResult() in components/global-search.tsx
export interface SearchResourceMeta {
  type: SearchResultType
  label: string
  icon: LucideIcon
}

export const SEARCH_RESOURCES: SearchResourceMeta[] = [
  { type: "device", label: "Devices", icon: HardDriveIcon },
  { type: "workflow-template", label: "Workflow Templates", icon: WorkflowIcon },
  { type: "workflow-instance", label: "Workflow Instances", icon: PlayIcon },
  { type: "dataset", label: "Datasets", icon: ImagesIcon },
  { type: "model", label: "Models", icon: BoxesIcon },
]
