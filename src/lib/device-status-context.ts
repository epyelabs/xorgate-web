import { createContext } from "react"

/**
 * Where the replay's status runs came from, for the Device status dialog's
 * colour-key "Approximate" note. The replay page provides
 * `statusRunsSource`; live leaves the default (null, no note).
 */
export const DeviceStatusSourceContext = createContext<
  "insight" | "overview" | null
>(null)
