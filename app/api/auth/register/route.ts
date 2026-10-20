import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const registerSchema = z.object({
  name: z.string().min(2).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(256),
});

export async function POST(request: Request) {
  if (process.env.DEMO_MODE === "true") {
    return NextResponse.json({ error: "This demo is read-only. No changes were saved." }, { status: 403 });
  }
  const local = process.env.LOCAL_WORKSPACE_MODE === "true";
  if (local && (process.env.DEMO_MODE !== "false" || process.env.NEXT_PUBLIC_DEMO_MODE !== "false")) {
    return NextResponse.json({ error: "Local workspace mode is misconfigured." }, { status: 503 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(local && process.env.AUTH_URL ? process.env.AUTH_URL : request.url).origin) {
    return NextResponse.json({ error: "Cross-origin registration is not allowed." }, { status: 403 });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Send an application/json request." }, { status: 415 });
  }
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.$transaction(async (tx) => {
      if (local) {
        // ponytail: one operator per installation; an advisory lock serializes first-owner signup.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261020, 1)`;
        if (await tx.user.count() !== 0) return null;
      }
      return tx.user.create({
        data: { name, email, password: hashedPassword, role: local ? "admin" : "viewer" },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!user) {
      return NextResponse.json({ error: "This local workspace already has an owner. Sign in with that account." }, { status: 403 });
    }
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "User already exists" }, { status: 409 });
    }
    console.error("Registration failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
