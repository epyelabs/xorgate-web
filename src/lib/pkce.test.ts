import { describe, it, expect, beforeEach } from "vitest"
import {
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
  rememberPkce,
  takePkce,
} from "./pkce"

// Node has no sessionStorage; a minimal in-memory stand-in is enough because
// the helpers only use getItem/setItem/removeItem.
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  ;(globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage()
})

describe("pkce", () => {
  it("generates a spec-length base64url verifier and a S256 challenge", async () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const challenge = await codeChallengeFromVerifier(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // Deterministic for the same verifier.
    expect(await codeChallengeFromVerifier(verifier)).toBe(challenge)
    // Known vector from RFC 7636 appendix B.
    expect(
      await codeChallengeFromVerifier(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
      )
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })

  it("round-trips the verifier and return path, then clears the stash", () => {
    const state = generateState()
    rememberPkce("v-123", state, "/devices/abc")
    expect(takePkce(state)).toEqual({ verifier: "v-123", returnTo: "/devices/abc" })
    expect(() => takePkce(state)).toThrow(/Missing PKCE verifier/)
  })

  it("omits returnTo when none was remembered, clearing any stale one", () => {
    rememberPkce("v-1", "s-1", "/stale")
    rememberPkce("v-2", "s-2")
    expect(takePkce("s-2")).toEqual({ verifier: "v-2", returnTo: undefined })
  })

  it("rejects a state that does not match the one stored", () => {
    rememberPkce("v-123", "expected")
    expect(() => takePkce("forged")).toThrow(/OAuth state mismatch/)
    // The stash is consumed either way, so a second attempt cannot succeed.
    expect(() => takePkce("expected")).toThrow(/Missing PKCE verifier/)
  })
})
