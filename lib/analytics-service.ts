export async function analyticsService(path: "/v1/prediction" | "/v1/refresh", revision?: number) {
  const base = new URL(process.env.REV_ANALYTICS_URL ?? "http://127.0.0.1:8101");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:") throw new Error("Use a loopback analytics service");
  const token = process.env.REV_ANALYTICS_TOKEN;
  if (!token || token.length < 32) throw new Error("Local analytics is not configured; use the startup script");
  let response: Response;
  try { response = await fetch(new URL(path, base), { method: revision === undefined ? "GET" : "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(revision === undefined ? {} : { body: JSON.stringify({ revision }) }), signal: AbortSignal.timeout(150000) }); }
  catch { throw new Error("Local Python analytics is unavailable. Start or restart the local service, then retry. Stored records are unchanged."); }
  if (!response.ok) throw new Error(response.status === 409 ? "Data saved; analytics pending. Retry refresh from Data workspace." : "Local Python analytics is unavailable. Start or restart the local service, then retry.");
  return response.json();
}
