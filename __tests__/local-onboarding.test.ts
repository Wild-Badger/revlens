import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const db = vi.hoisted(() => ({
  count: vi.fn(), create: vi.fn(), lock: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: db.transaction } }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "password-hash") } }));
vi.mock("@/auth", () => ({ auth: (handler: unknown) => handler }));
import { POST } from "@/app/api/auth/register/route";
import { proxy } from "@/proxy";

const input = { name: "Local owner", email: "owner@example.test", password: "public-test-password" };
const register = (body = input) => POST(new Request("http://127.0.0.1:3101/api/auth/register", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("LOCAL_WORKSPACE_MODE", "true");
  vi.stubEnv("AUTH_URL", "http://127.0.0.1:3101");
  db.count.mockResolvedValue(0);
  db.create.mockImplementation(async ({ data }) => ({ id: "owner-id", name: data.name, email: data.email, role: data.role }));
  db.transaction.mockImplementation(async (run) => run({ $executeRaw: db.lock, user: { count: db.count, create: db.create } }));
});
afterEach(() => vi.unstubAllEnvs());

describe("local owner onboarding", () => {
  it("lets anonymous users reach signup while other writes still require sign-in", async () => {
    for (const [path, expected] of [["/api/auth/register", 200], ["/api/import/commit", 401]] as const) {
      const request = Object.assign(new NextRequest(`http://127.0.0.1:3101${path}`, { method: "POST" }), { auth: null });
      expect((await proxy(request, { params: Promise.resolve({}) }))?.status).toBe(expected);
    }
  });

  it("creates an admin only after taking the first-owner transaction lock", async () => {
    const response = await register();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ role: "admin" });
    expect(db.lock).toHaveBeenCalledOnce();
    expect(db.lock.mock.invocationCallOrder[0]).toBeLessThan(db.count.mock.invocationCallOrder[0]);
    expect(db.count.mock.invocationCallOrder[0]).toBeLessThan(db.create.mock.invocationCallOrder[0]);
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    expect(db.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ password: "password-hash" }) }));
  });

  it("closes local registration after an owner exists", async () => {
    db.count.mockResolvedValue(1);
    expect((await register()).status).toBe(403);
    expect(db.create).not.toHaveBeenCalled();
  });

  it("keeps ordinary nonlocal signup at viewer role", async () => {
    vi.stubEnv("LOCAL_WORKSPACE_MODE", "false");
    expect(await (await register()).json()).toMatchObject({ role: "viewer" });
    expect(db.lock).not.toHaveBeenCalled();
    expect(db.count).not.toHaveBeenCalled();
  });

  it("preserves read-only mode and rejects conflicting local flags", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect((await register()).status).toBe(403);
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    expect((await register()).status).toBe(503);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns a conflict for duplicate email without leaking a database error", async () => {
    db.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("private details", { code: "P2002", clientVersion: "6" }));
    const response = await register();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "User already exists" });
  });

  it("rejects invalid input before a database transaction", async () => {
    expect((await register({ ...input, password: "short" })).status).toBe(400);
    expect((await POST(new Request("http://127.0.0.1:3101/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status).toBe(400);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and form-based attempts to claim the owner account", async () => {
    for (const [headers, status] of [
      [{ "Content-Type": "application/json", Origin: "https://unrelated.example" }, 403],
      [{ "Content-Type": "text/plain" }, 415],
    ] as const) {
      expect((await POST(new Request("http://127.0.0.1:3101/api/auth/register", { method: "POST", headers, body: JSON.stringify(input) }))).status).toBe(status);
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("keeps local and demo build output separate", async () => {
    vi.resetModules();
    expect((await import("@/next.config")).default).toMatchObject({ distDir: ".next-local" });
    vi.stubEnv("LOCAL_WORKSPACE_MODE", "false");
    vi.resetModules();
    expect((await import("@/next.config")).default).toMatchObject({ distDir: ".next", output: "standalone" });
  });
});
