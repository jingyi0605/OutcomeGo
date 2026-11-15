import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createToolValidator } from "@outcomego/plugin-sdk/json-schema";
import { routePlaces, searchNearbyPlaces, searchPlaces, type Fetcher } from "./amap";

type Schema = {
  type: "object";
  properties: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Schema;
  annotations: { readOnlyHint: true; destructiveHint: false; openWorldHint: true };
  run: (args: any, fetcher: Fetcher, signal?: AbortSignal) => Promise<unknown>;
};

const latitude = { type: "number", minimum: -90, maximum: 90 };
const longitude = { type: "number", minimum: -180, maximum: 180 };
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;

export const tools: Tool[] = [
  {
    name: "SearchPlaces",
    description:
      "Find real places, landmarks or addresses with Amap. Include the city or address to distinguish branches. Coordinates returned by this tool are normalized for OpenTeam map presentations.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 80, description: "A place name, landmark or address." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Default 5." },
        latitude,
        longitude,
        region: { type: "string", minLength: 1, maxLength: 40, description: "Optional city or administrative region." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: read,
    run: (args, fetcher, signal) => searchPlaces(args, fetcher, signal),
  },
  {
    name: "SearchNearbyPlaces",
    description:
      "Find places near a point with Amap, such as restaurants, coffee shops, pharmacies or supermarkets. Pass the center's latitude and longitude from SearchPlaces. Returns normalized coordinates, distance, address, phone and available business hours.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 2, maxLength: 80, description: "What to find, such as restaurant, coffee or pharmacy." },
        latitude,
        longitude,
        radiusMeters: { type: "integer", minimum: 1, maximum: 50000, description: "Default 1500." },
        limit: { type: "integer", minimum: 1, maximum: 20, description: "Default 10." },
        region: { type: "string", minLength: 1, maxLength: 40, description: "Optional city or administrative region." },
      },
      required: ["query", "latitude", "longitude"],
      additionalProperties: false,
    },
    annotations: read,
    run: (args, fetcher, signal) => searchNearbyPlaces(args, fetcher, signal),
  },
  {
    name: "RoutePlaces",
    description:
      "Compute a real walking, cycling or driving route through 2–10 places in visit order with Amap. Returns normalized route geometry, total and per-leg distance and duration, and turn instructions.",
    inputSchema: {
      type: "object",
      properties: {
        places: {
          type: "array",
          minItems: 2,
          maxItems: 10,
          description: "Stops in visit order, usually from SearchPlaces or SearchNearbyPlaces.",
          items: {
            type: "object",
            properties: { id: { type: "string", minLength: 1, maxLength: 200 }, name: { type: "string" }, latitude, longitude },
            required: ["id", "latitude", "longitude"],
            additionalProperties: false,
          },
        },
        mode: { type: "string", enum: ["walking", "driving", "cycling"] },
      },
      required: ["places", "mode"],
      additionalProperties: false,
    },
    annotations: read,
    run: (args, fetcher, signal) => routePlaces(args, fetcher, signal),
  },
];

const validators = new Map(tools.map((tool) => [tool.name, createToolValidator(tool.inputSchema)]));

export async function callTool(name: string, args: unknown, fetcher: Fetcher = fetch, signal?: AbortSignal) {
  try {
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new Error("Unknown tool");
    const result = validators.get(name)!(args ?? {});
    if (!result.valid) throw new Error(`Invalid tool arguments: ${result.errorMessage}`);
    const value = await tool.run(args ?? {}, fetcher, signal);
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Amap tool failed" }],
    };
  }
}

export async function serveAmap() {
  const server = new Server({ name: "openteam-amap", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    callTool(request.params.name, request.params.arguments, fetch, extra.signal)
  );
  await server.connect(new StdioServerTransport());
}

if (import.meta.main) await serveAmap();
