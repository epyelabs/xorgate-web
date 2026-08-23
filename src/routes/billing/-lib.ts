import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import type { UserTier } from "@xorgate/sdk"

// ---------------------------------------------------------------------------
// Mock billing data. In production these come from the billing service; the
// shapes mirror what xorgate actually meters — devices in the field, cellular
// data streamed, AI Layer workflow runs, and recording storage.
// ---------------------------------------------------------------------------

export interface Plan {
  id: UserTier
  name: string
  price: number
  tagline: string
  popular?: boolean
  limits: {
    devices: number
    streamingGb: number
    workflowRuns: number
    storageGb: number
    retentionDays: number
  }
  features: string[]
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "Evaluate a single kit end-to-end.",
    limits: {
      devices: 1,
      streamingGb: 5,
      workflowRuns: 100,
      storageGb: 5,
      retentionDays: 7,
    },
    features: [
      "1 connected device",
      "5 GB / mo streaming",
      "100 workflow runs / mo",
      "7-day recording retention",
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49,
    tagline: "Ship your first fleet to the field.",
    popular: true,
    limits: {
      devices: 10,
      streamingGb: 250,
      workflowRuns: 5000,
      storageGb: 300,
      retentionDays: 30,
    },
    features: [
      "Up to 10 connected devices",
      "250 GB / mo streaming",
      "5,000 workflow runs / mo",
      "VLM scene queries",
      "30-day recording retention",
      "Email support",
    ],
  },
  {
    id: "team",
    name: "Team",
    price: 199,
    tagline: "Run production fleets at scale.",
    limits: {
      devices: 50,
      streamingGb: 1024,
      workflowRuns: 25000,
      storageGb: 2048,
      retentionDays: 90,
    },
    features: [
      "Up to 50 connected devices",
      "1 TB / mo streaming",
      "25,000 workflow runs / mo",
      "Custom workflow templates",
      "90-day retention",
      "SSO & priority support",
    ],
  },
]

export const TIER_ORDER: Record<UserTier, number> = { free: 0, pro: 1, team: 2 }

// Current cycle usage (mock). Kept close to Pro limits so the metering,
// progress states, and the contextual upgrade nudge are all visible.
export const USAGE = {
  devices: 7,
  streamingGb: 168,
  workflowRuns: 4620,
  storageGb: 190,
}

export interface Metric {
  key: string
  label: string
  icon: LucideIcon
  used: number
  limit: number
  unit: string
}

export interface Invoice {
  number: string
  date: string
  description: string
  amount: number
  status: "paid" | "upcoming" | "failed"
}

export const INVOICES: Invoice[] = [
  {
    number: "INV-2026-008",
    date: "Aug 1, 2026",
    description: "Pro plan — monthly",
    amount: 49,
    status: "upcoming",
  },
  {
    number: "INV-2026-007",
    date: "Jul 1, 2026",
    description: "Pro plan — monthly",
    amount: 49,
    status: "paid",
  },
  {
    number: "INV-2026-006",
    date: "Jun 1, 2026",
    description: "Pro plan — monthly + 38 GB streaming overage",
    amount: 56.6,
    status: "paid",
  },
  {
    number: "INV-2026-005",
    date: "May 1, 2026",
    description: "Pro plan — monthly",
    amount: 49,
    status: "paid",
  },
  {
    number: "INV-2026-004",
    date: "Apr 1, 2026",
    description: "Pro plan — monthly",
    amount: 49,
    status: "paid",
  },
]

// Percent at which a usage meter turns "destructive".
export const NEAR_LIMIT = 85

export function money(value: number, cents = true): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })
}

export const compact = (value: number) => value.toLocaleString("en-US")

export function notImplemented() {
  toast.info("Billing isn't enabled in this preview.")
}
