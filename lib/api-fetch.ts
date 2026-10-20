/** Keep local API calls native; only the public static build loads fictional responses. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (process.env.NEXT_PUBLIC_STATIC_DEMO === "true") {
    const { demoFetch } = await import("@/demo/api");
    return demoFetch(input, init);
  }
  return fetch(input, init);
}

/** Static hosting keeps filters before the route hash so location.search still works. */
export function replaceRouteQuery(route: string, params: URLSearchParams) {
  const query = params.size ? `?${params}` : "";
  const url = process.env.NEXT_PUBLIC_STATIC_DEMO === "true"
    ? `${window.location.pathname}${query}#${route}`
    : `${route}${query}`;
  window.history.replaceState(null, "", url);
}
