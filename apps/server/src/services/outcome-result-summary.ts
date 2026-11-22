import { ApiError } from "@outcomego/contracts";
import type { SubmitPrereviewInput } from "@outcomego/contracts/outcome-thread";
import type {
  EvidenceCredibility,
  OutcomeResultChart,
  OutcomeResultSummary,
} from "@outcomego/contracts/outcomes";

type PrereviewEvidence = { id: string; sourceType: string; contentSummary: string; credibility: EvidenceCredibility };

const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

/**
 * The reviewer supplies conclusions, citations and chart data in one submission; presentation never asks
 * another model and never interprets the reviewer's prose. The only checks here are mechanical: every chart
 * point must quote text that really exists in the record or saved file it cites, and the quote must contain
 * the point's label, its single reading and the unit.
 */
export function assemblePrereviewReport(
  outcomeId: string, revisionId: string, reviewTurnId: string, summary: string,
  results: readonly { evidenceIds: readonly string[]; reason?: string }[], evidence: readonly PrereviewEvidence[],
  charts: NonNullable<SubmitPrereviewInput["charts"]>, files: ReadonlyMap<string, string> = new Map(),
): OutcomeResultSummary {
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const sources: OutcomeResultSummary["sources"] = [];
  const addSource = (source: OutcomeResultSummary["sources"][number]) => {
    const index = sources.findIndex((entry) => entry.evidenceId === source.evidenceId &&
      entry.title === source.title && entry.quote === source.quote);
    return index !== -1 ? index : sources.push(source) - 1;
  };
  for (const id of new Set(results.flatMap((entry) => entry.evidenceIds))) {
    const row = byId.get(id);
    if (row?.contentSummary.trim()) {
      addSource({ evidenceId: row.id, title: row.sourceType, quote: row.contentSummary.slice(0, 600), credibility: row.credibility });
    }
  }
  const invalid = (message: string): never => {
    throw new ApiError(400, "invalid_request", message, { field: "charts" });
  };
  const grounded = charts.flatMap((chart) => {
    const citations: OutcomeResultSummary["sources"] = [];
    const points = [];
    for (const { evidenceId, file, quote, label, row, value } of chart.points) {
      let source: OutcomeResultSummary["sources"][number];
      let text: string;
      if (file !== undefined) {
        text = files.get(file) ?? invalid(`Chart point "${label}": file ${file} could not be read`);
        source = { title: file.split("/").at(-1) ?? file, quote, credibility: "agent_report" };
      } else {
        const record = byId.get(evidenceId ?? "");
        if (!record) return invalid(`Chart point "${label}": evidence ${evidenceId} was not found for this goal`);
        text = record.contentSummary;
        source = { evidenceId: record.id, title: record.sourceType, quote, credibility: record.credibility };
      }
      if (!text.includes(quote)) invalid(`Chart point "${label}": the quote does not appear in its source; copy an exact excerpt`);
      const excerpt = normalize(quote);
      if (!excerpt.includes(normalize(label.trim())) || (row && !excerpt.includes(normalize(row.trim())))) {
        invalid(`Chart point "${label}": the quote must contain the point's label${row ? " and row" : ""}`);
      }
      const readings = [...recordedValues(quote, chart.unit.trim())];
      if (readings.length !== 1 || readings[0] !== value) {
        invalid(`Chart point "${label}": the quote must contain exactly one reading of ${value} ${chart.unit}`);
      }
      points.push({ label, row, value, citation: citations.length });
      citations.push(source);
    }
    const parsed = parseChart({ ...chart, points }, citations);
    if (!parsed) return invalid(`Chart "${chart.title}" is not a valid ${chart.type} chart; check the point count and values`);
    return [{ ...parsed, points: parsed.points.map((point) => ({
      ...point, citation: addSource(citations[point.citation]!),
    })) }];
  });
  return { outcomeId, revisionId, reviewTurnId, summary, details: "", sources, charts: grounded };
}

const CHART_TYPES = ["metric", "bar", "line", "pie", "heatmap"] as const;
const chartLabel = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

function parseChart(value: unknown, sources: OutcomeResultSummary["sources"]): OutcomeResultChart | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const type = CHART_TYPES.find((candidate) => candidate === data.type);
  if (!type || !chartLabel(data.title, 120) || typeof data.unit !== "string" ||
      data.unit.length > 24 || !Array.isArray(data.points) || data.points.length > 24) return null;
  const unit = data.unit.trim();
  const points: OutcomeResultChart["points"] = [];
  for (const value of data.points) {
    if (!value || typeof value !== "object") return null;
    const { label, row, value: number, citation } = value as Record<string, unknown>;
    if (!chartLabel(label, 72) || typeof number !== "number" || !Number.isFinite(number) ||
        Math.abs(number) > Number.MAX_SAFE_INTEGER || typeof citation !== "number" ||
        !Number.isInteger(citation) || !sources[citation] ||
        (type === "heatmap" && !chartLabel(row, 72))) return null;
    if (!hasRecordedValue(sources[citation]!.quote, number, unit)) return null;
    points.push({
      label: label.trim(),
      value: number,
      citation,
      ...(typeof row === "string" && type === "heatmap" ? { row: row.trim() } : {}),
    });
  }
  const labels = new Set(points.map((point) => point.label));
  const rows = new Set(points.map((point) => point.row));
  const cells = new Set(points.map((point) => JSON.stringify([point.row, point.label])));
  if (cells.size !== points.length) return null;
  switch (type) {
    case "metric":
      if (points.length !== 1) return null;
      break;
    case "line":
      if (points.length < 3) return null;
      break;
    case "pie":
      if (points.length < 2 || points.length > 8 || points.some((point) => point.value <= 0)) return null;
      break;
    case "heatmap":
      if (rows.size < 2 || labels.size < 2 || points.length !== rows.size * labels.size) return null;
      break;
    case "bar":
      if (points.length < 2) return null;
      break;
  }
  return { type, title: data.title.trim(), unit, points };
}

function hasRecordedValue(quote: string, value: number, unit: string): boolean {
  for (const recorded of recordedValues(quote, unit)) if (recorded === value) return true;
  return false;
}

function* recordedValues(quote: string, unit: string): Generator<number> {
  const text = quote.normalize("NFKC").replaceAll("−", "-");
  const normalizedUnit = unit.normalize("NFKC");
  const readings = text.matchAll(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  for (const match of readings) {
    const suffix = text.slice(match.index + match[0].length).trimStart();
    if (!normalizedUnit ||
        (suffix.startsWith(normalizedUnit) && !/^[A-Za-z_]/.test(suffix.slice(normalizedUnit.length))) ||
        (/^\p{Sc}$/u.test(normalizedUnit) && text.slice(0, match.index).trimEnd().endsWith(normalizedUnit))) {
      yield Number(match[0].replaceAll(",", ""));
    }
  }
}
