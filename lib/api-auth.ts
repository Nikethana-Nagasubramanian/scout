/**
 * Scout's dev server binds 0.0.0.0, so anything on the same network can reach it. Reads
 * are already open, but an endpoint that changes application state needs a shared secret.
 * Set SCOUT_API_TOKEN in .env and send it as `Authorization: Bearer <token>`.
 */
export function apiTokenConfigured(): boolean {
  return (process.env.SCOUT_API_TOKEN || "").trim().length > 0;
}

export function authorizeRequest(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const expected = (process.env.SCOUT_API_TOKEN || "").trim();
  if (!expected) {
    return { ok: false, status: 503, error: "SCOUT_API_TOKEN is not set. Add it to .env and restart Scout before using this endpoint." };
  }
  const header = request.headers.get("authorization") || "";
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  if (presented !== expected) {
    return { ok: false, status: 401, error: "Missing or incorrect bearer token." };
  }
  return { ok: true };
}
