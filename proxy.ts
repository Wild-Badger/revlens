import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const proxy = auth((request) => {
  const path = request.nextUrl.pathname;
  const authEndpoint = path.startsWith("/api/auth/") && path !== "/api/auth/register";
  if (authEndpoint) return NextResponse.next();

  // ponytail: a shared synthetic workspace stays read-only; private per-user demos need separate storage.
  if (process.env.DEMO_MODE === "true" && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return NextResponse.json({ error: "This demo is read-only. No changes were saved." }, { status: 403 });
  }

  const publicPage = ["/login", "/signup", "/"].includes(path);
  const registration = path === "/api/auth/register" && request.method === "POST";
  if (!request.auth && !publicPage && !registration) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (request.auth && ["/login", "/signup"].includes(path)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
});

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
