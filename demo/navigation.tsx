import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";

const routes = new Set(["/dashboard", "/movements", "/retention", "/churn", "/customers", "/forecast", "/data", "/import"]);
let currentPath = "/dashboard";

function readPathname() {
  const path = window.location.hash.slice(1).split("?")[0];
  if (routes.has(path)) currentPath = path;
  return currentPath;
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

export function usePathname() {
  return useSyncExternalStore(subscribe, readPathname, () => "/dashboard");
}

export function demoHref(href: string) {
  if (!href.startsWith("/")) return href;
  const [pathname, query = ""] = href.split("?");
  return `${window.location.pathname}${query ? `?${query}` : ""}#${pathname}`;
}

export default function Link({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} href={demoHref(href)}>{children}</a>;
}
