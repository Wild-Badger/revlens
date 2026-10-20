import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));
import { proxy } from "@/proxy";

async function request(path: string, method = "GET", signedIn = false) {
  const req = Object.assign(new NextRequest(`http://localhost${path}`, { method }), {
    auth: signedIn ? { user: { id: "demo", role: "viewer" } } : null,
  });
  return (await proxy(req, { params: Promise.resolve({}) })) as Response;
}

afterEach(() => vi.unstubAllEnvs());

describe("session and demo access", () => {
  it("denies anonymous API reads and redirects protected pages", async () => {
    expect((await request("/api/revenue/summary")).status).toBe(401);
    const page = await request("/customers");
    expect(page.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows signed-in reads without opening writes in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect((await request("/api/revenue/summary", "GET", true)).status).toBe(200);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await request("/api/import/commit", method, true)).status).toBe(403);
    }
    expect((await request("/api/auth/register", "POST")).status).toBe(403);
  });

  it("preserves sign-in and sign-out in read-only mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect((await request("/api/auth/callback/demo", "POST")).status).toBe(200);
    expect((await request("/api/auth/signout", "POST", true)).status).toBe(200);
    expect((await request("/login")).status).toBe(200);
  });
});
