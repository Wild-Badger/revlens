import { expect, it } from "vitest";
import { toCsv } from "./export";

it("preserves quoted multiline text and numeric losses while neutralizing spreadsheet formulas", () => {
  expect(toCsv([["São Paulo, \"North\"\nDesk", -12.34, null], [" =SUM(A1)", "\t@command", "-name"]])).toBe(
    '"São Paulo, ""North""\nDesk","-12.34",""\r\n"\' =SUM(A1)","\'\t@command","\'-name"',
  );
});
