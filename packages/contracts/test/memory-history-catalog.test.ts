import { expect, test } from "bun:test";
import { NATIVE_TOOLS } from "../src";
import native from "../src/native-tools.json";
import reference from "../src/tool-reference.json";
import { normalizeMainToolArguments } from "../src/reference-main-parsers";
import { referenceTool } from "../src/tool-contracts";

test("RecallMemory catalogs expose the supported optional history argument without changing defaults", () => {
  const capturedNative = native.native.find(tool => tool.name === "RecallMemory")!;
  const liveNative = NATIVE_TOOLS.find(tool => tool.name === "RecallMemory")!;
  const contracts = [
    { description: capturedNative.description, schema: capturedNative.parameters },
    { description: reference.RecallMemory.description, schema: reference.RecallMemory.inputSchema },
    { description: liveNative.description, schema: liveNative.inputSchema },
    { description: referenceTool("RecallMemory").description, schema: referenceTool("RecallMemory").inputSchema },
  ];
  for (const { description, schema } of contracts) {
    expect((schema.properties as Record<string, unknown>).includeHistory).toEqual({
      type: "boolean",
      description: "Include superseded facts, labeled as historical. Default false.",
    });
    expect(schema.required).toEqual(["query"]);
    expect(description).toContain("superseded");
  }
  expect(normalizeMainToolArguments("RecallMemory", { query: "player" })).toEqual({ query: "player" });
  expect(normalizeMainToolArguments("RecallMemory", { query: "player", includeHistory: true }))
    .toEqual({ query: "player", includeHistory: true });
  expect(normalizeMainToolArguments("RecallMemory", { query: "player", includeHistory: false }))
    .toEqual({ query: "player", includeHistory: false });
});
