import { getIdToken } from "./cognito"

const API_URL = import.meta.env.VITE_API_BASE_URL as string

let currentOrgIdGetter: () => string | null = () => null
let currentProjectIdGetter: () => string | null = () => null

export function registerOrgIdGetter(fn: () => string | null) {
  currentOrgIdGetter = fn
}

export function registerProjectIdGetter(fn: () => string | null) {
  currentProjectIdGetter = fn
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken()
  if (!token) throw new Error("Not authenticated")
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = "ApiError"
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = await authHeaders()
  const orgId = currentOrgIdGetter()
  if (orgId) headers["X-Organization-Id"] = orgId
  const projectId = currentProjectIdGetter()
  if (projectId) headers["X-Project-Id"] = projectId
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...init.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type UserTier = "free" | "pro" | "team"
export type UserRole = "user" | "admin"
export type MembershipRole = "owner" | "admin" | "member" | "viewer"

export interface MeUser {
  id: string
  email: string
  name: string | null
  tier: UserTier
  role: UserRole
}

export interface Membership {
  id: string
  userId: string
  organizationId: string
  role: MembershipRole
  createdAt: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface MeResponse {
  user: MeUser
  memberships: Membership[]
  organizations: Organization[]
}

export async function getMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>("/me")
}

export async function listOrganizations(): Promise<{ organizations: Organization[] }> {
  return apiRequest("/organizations")
}

export async function createOrganization(input: {
  name: string
  slug: string
}): Promise<{ organization: Organization }> {
  return apiRequest("/organizations", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function listProjects(): Promise<{ projects: Project[] }> {
  return apiRequest("/projects")
}

export async function createProject(input: {
  name: string
  slug: string
  description?: string
}): Promise<{ project: Project }> {
  return apiRequest("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export type DeviceStatus =
  | "provisioned"
  | "online"
  | "offline"
  | "decommissioned"

export interface Device {
  id: string
  projectId: string
  deviceModelId: string
  serial: string
  name: string | null
  firmwareVersion: string | null
  status: DeviceStatus
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export async function listDevices(): Promise<{ devices: Device[] }> {
  return apiRequest("/devices")
}

export async function getDevice(id: string): Promise<{ device: Device }> {
  return apiRequest(`/devices/${id}`)
}
