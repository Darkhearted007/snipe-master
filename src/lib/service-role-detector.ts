// Detects accidentally exposed Supabase service_role JWTs in browser-reachable
// surfaces: pasted text in inputs/textareas, localStorage, sessionStorage.
// Pure client-side check — never sends the token anywhere.

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Returns true if the given string appears to be a Supabase service_role JWT. */
export function isServiceRoleKey(candidate: string): boolean {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  // Fast reject: not a JWT-shaped string.
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return false;
  const payload = decodeJwtPayload(trimmed);
  if (!payload) return false;
  return payload.role === "service_role" && typeof payload.iss === "string";
}

/** Scans arbitrary text for an embedded service_role JWT. */
export function findServiceRoleInText(text: string): string | null {
  if (!text || text.length < 100) return null;
  const matches = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
  if (!matches) return null;
  for (const m of matches) if (isServiceRoleKey(m)) return m;
  return null;
}

/** Scans localStorage + sessionStorage for a service_role JWT. Returns the storage key. */
export function scanBrowserStorage(): {
  store: "localStorage" | "sessionStorage";
  key: string;
} | null {
  if (typeof window === "undefined") return null;
  for (const store of ["localStorage", "sessionStorage"] as const) {
    const s = window[store];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key) continue;
      const val = s.getItem(key) ?? "";
      if (findServiceRoleInText(val)) return { store, key };
    }
  }
  return null;
}
