import { ApiError } from "@outcomego/contracts";
import { json } from "../http";
import type { ExternalCalendarService } from "../services/external-calendar-service";
import type { OwnerTodoService } from "../services/owner-todo-service";
import type { RouteContext } from "./context";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export const createExternalCalendarRoutes = (
  external: ExternalCalendarService,
  owners: Pick<OwnerTodoService, "ownerForSession">,
) => async (context: RouteContext): Promise<Response | undefined> => {
  const { path, request, url, authMode, authenticatedSessionId } = context;
  if (!path.startsWith("/api/schedule/external")) return undefined;
  await owners.ownerForSession(authMode, authenticatedSessionId);
  const connectionId = url.searchParams.get("connectionId") ?? "";
  if (!uuid.test(connectionId)) throw new ApiError(400, "invalid_request", "Expected a connection ID");
  if (path === "/api/schedule/external/calendars" && request.method === "GET")
    return json(await external.calendars(connectionId), 200, { "cache-control": "no-store" });
  if (path === "/api/schedule/external" && request.method === "GET") {
    const calendarId = url.searchParams.get("calendarId") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!calendarId || !from || !to) throw new ApiError(400, "invalid_request", "Calendar ID and date range are required");
    return json(await external.events({ connectionId, calendarId, from, to, busyOnly: url.searchParams.get("busyOnly") === "true" }), 200, { "cache-control": "no-store" });
  }
  return undefined;
};
