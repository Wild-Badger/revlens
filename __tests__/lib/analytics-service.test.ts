// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { analyticsService } from "@/lib/analytics-service";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("turns an offline Python connection into actionable recovery guidance without exposing internals", async () => {
  vi.stubEnv("REV_ANALYTICS_TOKEN", "synthetic-unit-test-token-with-no-account-access");
  vi.stubEnv("REV_ANALYTICS_URL", "http://127.0.0.1:8101");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  await expect(analyticsService("/v1/refresh",4)).rejects.toThrow("Start or restart the local service, then retry. Stored records are unchanged.");
});
