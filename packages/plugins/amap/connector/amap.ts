/** Amap Web Service adapter.
 *
 * The application-facing boundary uses WGS-84 coordinates. Amap requests use GCJ-02,
 * so conversion happens inside this adapter and never leaks into the presentation contract.
 */

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type Coordinates = { latitude: number; longitude: number };
type RouteStop = Coordinates & { id: string; name?: string };

export type Place = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
  category?: string;
  websiteUrl?: string;
  isOpen?: boolean;
  hours?: string;
  provider: string;
  sourceUrl: string;
  attribution: string;
};

const BASE_URL = "https://restapi.amap.com";
const ATTRIBUTION = "高德地图";
const cache = new Map<string, { expires: number; value: unknown }>();
const EARTH_RADIUS = 6_378_245;
const PI = Math.PI;
const AXIS = 6378245.0;
const EE = 0.00669342162296594323;

export class AmapError extends Error {
  constructor(message: string, readonly reason: string, readonly definitive: boolean) {
    super(message);
  }
}

export function apiKey(): string {
  const key = process.env.AMAP_API_KEY?.trim();
  if (!key || /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(key)) {
    throw new AmapError(
      "No Amap Web Service API key is set. Add one in this plugin's account settings.",
      "API_KEY_MISSING",
      true
    );
  }
  return key;
}

export function resetAmapState() {
  cache.clear();
}

function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  return hit && hit.expires > Date.now() ? (hit.value as T) : undefined;
}

function remember<T>(key: string, value: T): T {
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 5 * 60_000, value });
  return value;
}

const clean = (value: unknown, max = 2000) =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const numberValue = (value: unknown, limit: number): number | undefined => {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= limit ? number : undefined;
};

function inChina(longitude: number, latitude: number) {
  return longitude >= 72.004 && longitude <= 137.8347 && latitude >= 0.8293 && latitude <= 55.8271;
}

function transformLatitude(longitude: number, latitude: number) {
  let result =
    -100 +
    2 * longitude +
    3 * latitude +
    0.2 * latitude * latitude +
    0.1 * longitude * latitude +
    0.2 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20 * Math.sin(6 * longitude * PI) + 20 * Math.sin(2 * longitude * PI)) * 2) / 3;
  result +=
    ((20 * Math.sin(latitude * PI) + 40 * Math.sin((latitude / 3) * PI)) * 2) / 3;
  result +=
    ((160 * Math.sin((latitude / 12) * PI) + 320 * Math.sin((latitude * PI) / 30)) * 2) / 3;
  return result;
}

function transformLongitude(longitude: number, latitude: number) {
  let result =
    300 +
    longitude +
    2 * latitude +
    0.1 * longitude * longitude +
    0.1 * longitude * latitude +
    0.1 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20 * Math.sin(6 * longitude * PI) + 20 * Math.sin(2 * longitude * PI)) * 2) / 3;
  result +=
    ((20 * Math.sin(longitude * PI) + 40 * Math.sin((longitude / 3) * PI)) * 2) / 3;
  result +=
    ((150 * Math.sin((longitude / 12) * PI) + 300 * Math.sin((longitude / 30) * PI)) * 2) / 3;
  return result;
}

export function toAmapPoint(point: Coordinates): Coordinates {
  if (!inChina(point.longitude, point.latitude)) return point;
  const dLat = transformLatitude(point.longitude - 105, point.latitude - 35);
  const dLon = transformLongitude(point.longitude - 105, point.latitude - 35);
  const radLat = (point.latitude / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  return {
    latitude: point.latitude + (dLat * 180) / (((AXIS * (1 - EE)) / (magic * sqrtMagic)) * PI),
    longitude: point.longitude + (dLon * 180) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI),
  };
}

export function fromAmapPoint(point: Coordinates): Coordinates {
  if (!inChina(point.longitude, point.latitude)) return point;
  const converted = toAmapPoint(point);
  return {
    latitude: point.latitude * 2 - converted.latitude,
    longitude: point.longitude * 2 - converted.longitude,
  };
}

export function distanceMeters(a: Coordinates, b: Coordinates) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function coordinateText(point: Coordinates) {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}

function parseCoordinate(value: unknown): Coordinates | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const longitude = numberValue(record.longitude ?? record.lon ?? record.lng, 180);
    const latitude = numberValue(record.latitude ?? record.lat, 90);
    if (longitude !== undefined && latitude !== undefined) return { longitude, latitude };
  }
  if (typeof value !== "string") return undefined;
  const parts = value.split(",");
  const longitude = Number(parts[0]);
  const latitude = Number(parts[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) &&
    Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90
    ? { longitude, latitude }
    : undefined;
}

function httpsUrl(value: unknown) {
  const text = clean(value, 4096);
  if (!text) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function sourceUrl(point: Coordinates, name: string) {
  const url = new URL("https://uri.amap.com/marker");
  url.searchParams.set("position", coordinateText(point));
  url.searchParams.set("name", name);
  url.searchParams.set("coordinate", "gaode");
  url.searchParams.set("callnative", "0");
  return url.href;
}

async function request(
  path: string,
  parameters: Record<string, string | number | undefined>,
  fetcher: Fetcher,
  signal?: AbortSignal
): Promise<any> {
  const url = new URL(path, BASE_URL);
  const key = apiKey();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  url.searchParams.set("key", key);
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { accept: "application/json" },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AmapError(
      `Amap could not be reached${error instanceof Error && error.name === "TimeoutError" ? " (timed out)" : ""}. Nothing was made up; retry shortly.`,
      "UNREACHABLE",
      false
    );
  }
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new AmapError(`Amap returned an invalid response (HTTP ${response.status}). Retry shortly.`, "INVALID_RESPONSE", false);
  }
  if (!response.ok) {
    throw new AmapError(`Amap returned HTTP ${response.status}. Retry shortly.`, `HTTP_${response.status}`, response.status === 401 || response.status === 403);
  }
  if (body?.status !== "1") {
    const info = clean(body?.info, 300) ?? "Unknown Amap error";
    const infocode = clean(body?.infocode, 40);
    throw new AmapError(
      `Amap rejected the request: ${info}${infocode ? ` (${infocode})` : ""}. Check the Web Service key and request parameters.`,
      infocode ?? "AMAP_ERROR",
      infocode === "10001" || infocode === "10003" || infocode === "10004"
    );
  }
  return body;
}

function poiRows(body: any): any[] {
  return Array.isArray(body?.pois) ? body.pois : [];
}

function placeFromPoi(raw: any): { place: Place; point: Coordinates; phone?: string } | null {
  const id = clean(raw?.id, 200);
  const name = clean(raw?.name);
  const amapPoint = parseCoordinate(raw?.location ?? raw?.center ?? raw);
  if (!id || !name || !amapPoint) return null;
  const point = fromAmapPoint(amapPoint);
  const address = clean(raw?.address ?? raw?.adname ?? raw?.business_area);
  const category = clean(raw?.type ?? raw?.typecode);
  const websiteUrl = httpsUrl(raw?.website ?? raw?.business?.website);
  const hours =
    clean(raw?.business?.opentime_today) ??
    clean(raw?.business?.opentime) ??
    clean(raw?.business?.opening_hours);
  const place: Place = {
    id: `amap:${id}`,
    name,
    latitude: point.latitude,
    longitude: point.longitude,
    ...(address ? { address } : {}),
    ...(category ? { category } : {}),
    ...(websiteUrl ? { websiteUrl } : {}),
    ...(hours ? { hours } : {}),
    provider: "Amap",
    sourceUrl: sourceUrl(amapPoint, name),
    attribution: ATTRIBUTION,
  };
  const phone = clean(raw?.tel ?? raw?.business?.tel, 100);
  return { place, point, ...(phone ? { phone } : {}) };
}

export async function searchPlaces(
  input: { query: string; limit?: number; latitude?: number; longitude?: number; region?: string },
  fetcher: Fetcher = fetch,
  signal?: AbortSignal
) {
  const limit = input.limit ?? 5;
  const location =
    input.latitude !== undefined && input.longitude !== undefined
      ? coordinateText(toAmapPoint({ latitude: input.latitude, longitude: input.longitude }))
      : undefined;
  const parameters = {
    keywords: input.query.trim(),
    ...(location ? { location } : {}),
    ...(input.region?.trim() ? { region: input.region.trim() } : {}),
    offset: limit,
    page: 1,
    extensions: "all",
  };
  const cacheKey = `text:${JSON.stringify(parameters)}`;
  const hit = cached<any>(cacheKey);
  if (hit) return hit;
  const body = await request("/v5/place/text", parameters, fetcher, signal);
  const places = poiRows(body)
    .slice(0, limit)
    .flatMap((row) => {
      const result = placeFromPoi(row);
      return result ? [{ place: result.place, ...(result.phone ? { phone: result.phone } : {}) }] : [];
    });
  return remember(cacheKey, {
    places,
    provider: "Amap",
    attribution: ATTRIBUTION,
    fetchedAt: new Date().toISOString(),
    instruction:
      "Check the city and address before choosing a result. For nearby searches around a named landmark, use the POI coordinates from this result rather than a separate geocoder result.",
  });
}

export async function searchNearbyPlaces(
  input: {
    query: string;
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    limit?: number;
    region?: string;
  },
  fetcher: Fetcher = fetch,
  signal?: AbortSignal
) {
  const radius = input.radiusMeters ?? 1_500;
  const limit = input.limit ?? 10;
  const center = { latitude: input.latitude, longitude: input.longitude };
  const gcjCenter = toAmapPoint(center);
  const parameters = {
    keywords: input.query.trim(),
    location: coordinateText(gcjCenter),
    radius,
    sortrule: "distance",
    ...(input.region?.trim() ? { region: input.region.trim() } : {}),
    offset: Math.min(25, Math.max(limit, 10)),
    page: 1,
    extensions: "all",
  };
  const cacheKey = `around:${JSON.stringify(parameters)}`;
  let body = cached<any>(cacheKey);
  if (!body) {
    body = await request("/v5/place/around", parameters, fetcher, signal);
    remember(cacheKey, body);
  }
  const results = poiRows(body)
    .flatMap((row) => {
      const result = placeFromPoi(row);
      if (!result) return [];
      const providerDistance = numberValue(row?.distance, 10_000_000);
      const distance = providerDistance ?? Math.round(distanceMeters(center, result.place));
      if (distance > radius) return [];
      return [{
        place: result.place,
        distanceMeters: Math.round(distance),
        ...(result.phone ? { phone: result.phone } : {}),
      }];
    })
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, limit);
  return {
    results,
    provider: "Amap",
    attribution: ATTRIBUTION,
    fetchedAt: new Date().toISOString(),
    instruction:
      "Results are sorted by distance when Amap provides a distance. Opening hours are included only when Amap returns them; do not infer open-now status from missing hours.",
  };
}

function polylinePoints(value: unknown): Coordinates[] {
  if (typeof value !== "string") return [];
  return value.split(";").flatMap((part) => {
    const point = parseCoordinate(part);
    return point ? [point] : [];
  });
}

function routePath(body: any): any | undefined {
  return body?.route?.paths?.[0] ?? body?.route?.path?.[0] ?? body?.paths?.[0];
}

function routeSteps(path: any): any[] {
  return Array.isArray(path?.steps) ? path.steps : [];
}

function routeDistance(path: any): number {
  return numberValue(path?.distance, 1_000_000_000) ?? 0;
}

function routeDuration(path: any): number {
  return numberValue(path?.duration ?? path?.cost?.duration, 10_000_000) ?? 0;
}

async function routeLeg(
  from: RouteStop,
  to: RouteStop,
  mode: "walking" | "driving" | "cycling",
  fetcher: Fetcher,
  signal?: AbortSignal
) {
  const endpoint = {
    walking: "/v5/direction/walking",
    driving: "/v5/direction/driving",
    cycling: "/v5/direction/bicycling",
  }[mode];
  const body = await request(
    endpoint,
    {
      origin: coordinateText(toAmapPoint(from)),
      destination: coordinateText(toAmapPoint(to)),
      ...(mode === "walking" ? { isindoor: 0 } : {}),
    },
    fetcher,
    signal
  );
  const path = routePath(body);
  if (!path) throw new Error("Amap could not resolve this route leg");
  const steps = routeSteps(path);
  const amapGeometry = steps.flatMap((step) => polylinePoints(step?.polyline));
  if (amapGeometry.length < 2) throw new Error("Amap returned a route without usable geometry");
  const geometry = amapGeometry.map((point) => fromAmapPoint(point));
  return {
    geometry,
    distanceMeters: routeDistance(path),
    durationSeconds: routeDuration(path),
    instructions: steps
      .flatMap((step) => {
        const instruction = clean(step?.instruction ?? step?.road, 2000);
        return instruction ? [instruction] : [];
      })
      .slice(0, 200),
  };
}

export async function routePlaces(
  input: { places: RouteStop[]; mode: "walking" | "driving" | "cycling" },
  fetcher: Fetcher = fetch,
  signal?: AbortSignal
) {
  if (new Set(input.places.map((place) => place.id)).size !== input.places.length)
    throw new Error("Route places must have distinct ids");
  const legs = [];
  for (let index = 0; index < input.places.length - 1; index += 1) {
    legs.push(await routeLeg(input.places[index]!, input.places[index + 1]!, input.mode, fetcher, signal));
  }
  const coordinates = legs.flatMap((leg, index) =>
    index === 0 ? leg.geometry : leg.geometry.slice(1)
  );
  if (coordinates.length < 2) throw new Error("Amap returned no complete route geometry");
  return {
    route: {
      id: `route:${crypto.randomUUID().slice(0, 13)}`,
      mode: input.mode,
      geometry: {
        type: "LineString",
        coordinates: coordinates.slice(0, 20_000).map((point) => [point.longitude, point.latitude]),
      },
      distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0),
      durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      legs: legs.map((leg, index) => ({
        fromPlaceId: input.places[index]!.id,
        toPlaceId: input.places[index + 1]!.id,
        distanceMeters: leg.distanceMeters,
        durationSeconds: leg.durationSeconds,
        instructions: leg.instructions,
      })),
      provider: "Amap",
      attribution: ATTRIBUTION,
    },
  };
}
