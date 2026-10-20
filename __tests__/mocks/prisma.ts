import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: { findMany: vi.fn() },
    customer: { findMany: vi.fn(), findUnique: vi.fn() },
    plan: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
    productEvent: { findMany: vi.fn() },
    $disconnect: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";

export const mockPrisma = prisma as unknown as {
  subscription: { findMany: ReturnType<typeof vi.fn> };
  customer: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  plan: { findMany: ReturnType<typeof vi.fn> };
  invoice: { findMany: ReturnType<typeof vi.fn> };
  payment: { findMany: ReturnType<typeof vi.fn> };
  productEvent: { findMany: ReturnType<typeof vi.fn> };
  $disconnect: ReturnType<typeof vi.fn>;
};
