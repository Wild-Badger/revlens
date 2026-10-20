"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@portfolio/ui/lib/utils";
import { signOut, useSession } from "next-auth/react";
import { ThemeToggle } from "@/components/theme-toggle";

const navigationItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Movements", href: "/movements" },
  { label: "Retention", href: "/retention" },
  { label: "Churn", href: "/churn" },
  { label: "Customers", href: "/customers" },
  { label: "Forecast", href: "/forecast" },
  { label: "Data workspace", href: "/data" },
];

function isActiveRoute(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  const userEmail = session.user.email ?? "";
  const userRole = session.user.role ?? "viewer";
  const userName = session.user.name ?? userEmail.split("@")[0];

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-neutral-200">{userName}</p>
        <p className="text-xs text-neutral-500 capitalize">{userRole}</p>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100"
      >
        Sign out
      </button>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (["/login", "/signup"].includes(pathname)) return <main>{children}</main>;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-800 bg-neutral-950/95 px-5 py-6 lg:block">
        <Link href="/dashboard" className="block">
          <p className="text-sm font-medium uppercase text-emerald-400">
            RevLens
          </p>
          <p className="mt-1 text-lg font-semibold text-neutral-50">
            Revenue Intelligence
          </p>
        </Link>

        <nav className="mt-8 space-y-1" aria-label="Dashboard sections">
          {navigationItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-neutral-800 text-neutral-50"
                    : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur sm:px-6 lg:hidden">
          <div className="flex items-center justify-between gap-4">
            <Link href="/dashboard" className="min-w-0">
              <p className="text-sm font-semibold text-neutral-50">RevLens</p>
              <p className="truncate text-xs text-neutral-400">
                Revenue Intelligence
              </p>
            </Link>
            <div className="flex flex-wrap items-center justify-end gap-2"><ThemeToggle /><UserMenu /></div>
          </div>
          <p className="mt-3 text-xs text-neutral-400">{process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "Portfolio demo · synthetic data · read-only" : "Local workspace · files stay on this computer"}</p>
          <details className="mt-3">
          <summary className="min-h-11 cursor-pointer rounded-md border border-neutral-700 px-3 py-3 text-sm">Menu · {navigationItems.find((item) => isActiveRoute(pathname, item.href))?.label ?? "RevLens"}</summary>
          <nav className="mt-2 grid grid-cols-2 gap-2" aria-label="Dashboard sections">
            {navigationItems.map((item) => {
              const active = isActiveRoute(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-neutral-800 text-neutral-50"
                      : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          </details>
        </header>

        <header className="sticky top-0 z-20 hidden border-b border-neutral-800 bg-neutral-950/95 px-6 py-3 backdrop-blur lg:flex lg:items-center lg:justify-between">
          <p className="text-xs text-neutral-400">{process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "Portfolio demo · synthetic data · read-only" : "Local workspace · files stay on this computer"}</p>
          <div className="flex items-center gap-3"><ThemeToggle /><UserMenu /></div>
        </header>

        <a href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-neutral-900 focus:p-3">Skip to content</a>
        <main id="main-content" tabIndex={-1} className="px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl space-y-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
