# xorgate-web

Xorgate's web app — **React 19 + TanStack Router + Vite + shadcn/ui**, authed with
**Cognito**. Talks to [`xorgate-core-service`](../../backend/xorgate-core-service)
over REST.

## Develop / build

```sh
npm run dev          # Vite dev server
npm run build        # routes:generate → tsc -b → vite build  (this is the real typecheck)
```

> `npm run typecheck` is effectively a no-op (empty root `files`); the real type
> check is `tsc -b`, run as part of `npm run build`.

Env (`.env`): `VITE_API_BASE_URL` (the API Gateway `execute-api` endpoint — no
custom DNS yet), `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`,
`VITE_COGNITO_IDENTITY_POOL_ID`, `VITE_AWS_REGION`, `VITE_IOT_ENDPOINT`.

## Structure

```
src/
  lib/api.ts          # fetch client — injects Authorization + X-Organization-Id + X-Project-Id
  lib/cognito.ts      # auth (sign-in, idToken)
  store/              # zustand: auth, workspace (currentOrganizationId / currentProjectId)
  routes/             # TanStack file routes (devices/, dashboard, …)
  components/ui/       # shadcn/ui
```

`apiRequest` automatically attaches the Cognito ID token and the active
org/project headers from the workspace store, so most calls are tenancy-scoped
without extra plumbing.

## Device provisioning

The **Devices** page (`src/routes/devices/index.tsx`) → **Provision device** opens
a dialog (`-components/provision-device-dialog.tsx`) that drives the zero-touch
onboarding flow:

1. On open it calls `createDeviceRegistration()` (`POST /device-registrations`,
   scoped to the active project) → a short-lived code + `installUrl`.
2. It renders the copy-paste command
   (`curl -s <installUrl> -o install.sh && sudo bash install.sh`) with a live
   countdown to expiry.
3. It polls `getDeviceRegistration(code)` every few seconds; when the device
   claims the code it flips to a "connected" state and refreshes the device list.
   Expired codes offer "generate a new one".

Both API helpers live in `src/lib/api.ts`. The backend renders and serves the
actual `install.sh`; see the
[backend README](../../backend/xorgate-core-service/README.md#device-lifecycle-registration--telemetry)
for the end-to-end flow, and the
[device agent README](../../device/xorgate-device-agent/README.md) for what runs
on the device.

## shadcn/ui

Add components:

```bash
npx shadcn@latest add button
```

They land in `src/components/ui`. Use them:

```tsx
import { Button } from "@/components/ui/button"
```
