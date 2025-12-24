import type { NextApiRequest } from "next";

export function getSnapshotAuthToken(req: NextApiRequest): string | null {
  // Prefer headers to avoid secrets in URLs/logs
  const headerToken = req.headers["x-snapshot-auth-token"];
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice("bearer ".length).trim();
    if (token) return token;
  }

  // Backward-compat: allow query param
  const q = req.query.authToken;
  const qToken = Array.isArray(q) ? q[0] : q;
  if (typeof qToken === "string" && qToken.trim()) return qToken.trim();

  return null;
}

export function assertSnapshotAuthorized(req: NextApiRequest) {
  const token = getSnapshotAuthToken(req);
  if (!token) throw new Error("Unauthorized");
  if (token !== process.env.SNAPSHOT_AUTH_TOKEN) throw new Error("Unauthorized");
}


