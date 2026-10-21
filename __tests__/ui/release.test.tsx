import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import RetentionPage from "@/app/retention/page";
import { StatisticalForecast } from "@/components/statistical-forecast";
import { AttributeHistory } from "@/components/attribute-history";
import data from "@/demo/data.json";
import { apiFetch } from "@/lib/api-fetch";

vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("recharts", async importOriginal => ({ ...await importOriginal<typeof import("recharts")>(), ResponsiveContainer: () => null }));
vi.mock("@portfolio/ui/components/card", () => ({ Card: ({children, ...props}: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> }));
vi.mock("@portfolio/ui/components/page-header", () => ({ PageHeader: ({title}: {title:string}) => <h1>{title}</h1> }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("shows every observed cohort month, including M47, in keyboard-focusable scrolling regions", async () => {
  const scope = Object.values(data.scopes)[0];
  vi.mocked(apiFetch).mockImplementation(async url => Response.json(String(url).includes("plan-retention") || String(url).includes("segment-retention") ? [] : scope.logo));
  render(<RetentionPage/>);
  expect(await screen.findAllByRole("columnheader",{name:"M47"})).toHaveLength(2);
  const regions=screen.getAllByRole("region",{name:/Monthly retention cohort table/});
  expect(regions).toHaveLength(2);
  for (const region of regions) expect(region).toHaveAttribute("tabindex","0");
});

it("exposes the unfavorable horizon result outside technical disclosure and before export", async () => {
  vi.mocked(apiFetch).mockResolvedValue(Response.json(data.prediction));
  render(<StatisticalForecast/>);
  const comparison=await screen.findByRole("region",{name:/Error and baseline comparison/});
  expect(within(comparison).getByText("$316.64")).toBeVisible();
  expect(within(comparison).getByText("$311.71")).toBeVisible();
  expect(comparison.closest("details")).toBeNull();
  const download=screen.getByRole("button",{name:"Export prediction JSON"});
  expect(comparison.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("does not render old captured attributes while the operational revision is pending", () => {
  render(<AttributeHistory status="pending" revision={4} analyticsRevision={3} versions={[{entity:"customer",entityId:"old",capturedFrom:"2026-01-01T00:00:00Z",capturedTo:null,sourceAsOf:"2025-12-31T00:00:00Z",deleted:false,attributes:{name:"Outdated capture"}}]}/>);
  expect(screen.getByRole("heading",{name:"Attribute capture pending"})).toBeVisible();
  expect(screen.queryByText("Outdated capture")).toBeNull();
});
