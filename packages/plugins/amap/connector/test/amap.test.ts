import { afterEach, beforeEach, expect, test } from "bun:test";
import { createToolValidator } from "@outcomego/plugin-sdk/json-schema";
import { PlaceRouteSchema, PlaceSchema } from "../../../../contracts/src/presentation";
import {
  apiKey,
  fromAmapPoint,
  resetAmapState,
  routePlaces,
  searchNearbyPlaces,
  searchPlaces,
  toAmapPoint,
  type Fetcher,
} from "../amap";
import { callTool as callServerTool, tools } from "../server";

const KEY = "amap-test-key";

beforeEach(() => {
  resetAmapState();
  process.env.AMAP_API_KEY = KEY;
});

afterEach(() => {
  delete process.env.AMAP_API_KEY;
});

const json = (value: unknown) => (async () => Response.json(value)) as Fetcher;

test("declares the three read-only map tools with bounded inputs", () => {
  expect(tools.map((tool) => tool.name)).toEqual(["SearchPlaces", "SearchNearbyPlaces", "RoutePlaces"]);
  for (const tool of tools) expect(tool.annotations.readOnlyHint).toBe(true);
  const valid = (name: string, args: unknown) =>
    createToolValidator(tools.find((tool) => tool.name === name)!.inputSchema)(args).valid;
  expect(valid("SearchNearbyPlaces", { query: "餐厅", latitude: 36.614, longitude: 116.966 })).toBe(true);
  expect(valid("SearchNearbyPlaces", { query: "餐厅", latitude: 36.614 })).toBe(false);
  expect(valid("RoutePlaces", { places: [{ id: "a", latitude: 1, longitude: 1 }], mode: "walking" })).toBe(false);
});

test("trims the key and refuses missing or unresolved placeholders", () => {
  process.env.AMAP_API_KEY = "  real-key  ";
  expect(apiKey()).toBe("real-key");
  process.env.AMAP_API_KEY = "${AMAP_API_KEY}";
  expect(() => apiKey()).toThrow("No Amap Web Service API key");
  delete process.env.AMAP_API_KEY;
  expect(() => apiKey()).toThrow("No Amap Web Service API key");
});

test("coordinate conversion round-trips mainland coordinates and leaves foreign coordinates alone", () => {
  const wgs = { longitude: 116.966603, latitude: 36.614384 };
  const gcj = toAmapPoint(wgs);
  expect(gcj.longitude).not.toBeCloseTo(wgs.longitude, 5);
  expect(gcj.latitude).not.toBeCloseTo(wgs.latitude, 5);
  const roundTrip = fromAmapPoint(gcj);
  expect(roundTrip.longitude).toBeCloseTo(wgs.longitude, 4);
  expect(roundTrip.latitude).toBeCloseTo(wgs.latitude, 4);
  const outside = { longitude: -73.99, latitude: 40.75 };
  expect(toAmapPoint(outside)).toEqual(outside);
});

test("search normalizes Amap POIs to presentation places and never exposes the key", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: URL) => {
    calls.push(String(url));
    return Response.json({
      status: "1",
      pois: [{
        id: "B000TEST",
        name: "济南大学（主校区）",
        location: "116.966603,36.614384",
        address: "山东省济南市",
        type: "科教文化服务;学校",
        tel: "0531-00000000",
        business: { opentime_today: "09:00-18:00" },
      }],
    });
  }) as Fetcher;
  const result = await searchPlaces({ query: "济南大学", limit: 5 }, fetcher);
  expect(result.places[0]).toMatchObject({
    place: {
      id: "amap:B000TEST",
      name: "济南大学（主校区）",
      provider: "Amap",
      attribution: "高德地图",
      hours: "09:00-18:00",
    },
    phone: "0531-00000000",
  });
  expect(PlaceSchema.safeParse(result.places[0]!.place).success).toBe(true);
  expect(new URL(calls[0]!).searchParams.get("key")).toBe(KEY);
  expect(JSON.stringify(result)).not.toContain(KEY);
});

test("nearby search converts the WGS-84 center before calling Amap and filters by distance", async () => {
  let request: URL | undefined;
  const fetcher = (async (url: URL) => {
    request = url;
    return Response.json({
      status: "1",
      pois: [
        { id: "near", name: "Near", location: "116.9667,36.6144", distance: "120", type: "餐饮服务" },
        { id: "far", name: "Far", location: "116.9900,36.6200", distance: "3000", type: "餐饮服务" },
      ],
    });
  }) as Fetcher;
  const result = await searchNearbyPlaces(
    { query: "餐厅", latitude: 36.614384, longitude: 116.966603, radiusMeters: 1000 },
    fetcher
  );
  expect(request?.searchParams.get("location")).not.toBe("116.966603,36.614384");
  expect(result.results.map((entry) => entry.place.name)).toEqual(["Near"]);
  expect(result.results[0]?.distanceMeters).toBe(120);
});

test("string status zero becomes a safe tool error with the Amap code", async () => {
  const result = await callServerTool("SearchPlaces", { query: "济南大学" }, json({
    status: "0",
    info: "INVALID_USER_KEY",
    infocode: "10001",
  }));
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain("10001");
  expect(result.content[0]!.text).not.toContain(KEY);
});

test("routes stitch complete Amap legs and return a valid presentation route", async () => {
  let count = 0;
  const fetcher = (async () => {
    count += 1;
    return Response.json({
      status: "1",
      route: {
        paths: [{
          distance: "700",
          duration: "540",
          steps: [{ polyline: "116.966603,36.614384;116.967000,36.615000", instruction: "向北行走" }],
        }],
      },
    });
  }) as Fetcher;
  const { route } = await routePlaces({
    places: [
      { id: "a", latitude: 36.614384, longitude: 116.966603 },
      { id: "b", latitude: 36.615000, longitude: 116.967000 },
      { id: "c", latitude: 36.616000, longitude: 116.968000 },
    ],
    mode: "walking",
  }, fetcher);
  expect(count).toBe(2);
  expect(route.legs).toHaveLength(2);
  expect(route.distanceMeters).toBe(1400);
  expect(route.provider).toBe("Amap");
  expect(PlaceRouteSchema.safeParse(route).success).toBe(true);
});

test("tool wrapper validates arguments and returns structured errors", async () => {
  const result = await callServerTool("SearchNearbyPlaces", { query: "餐厅" }, json({ status: "1", pois: [] }));
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain("Invalid tool arguments");
});
