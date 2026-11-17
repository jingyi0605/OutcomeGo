import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export const PARENT_FIXTURES = [
  "research-outcome", "decision-pending", "human-action",
  "duplicate-event", "fresh-install-import", "release-assets",
] as const;
export const RECOVERY_SCENARIOS = [
  "restart-running-run", "duplicate-finish-event", "interrupted-thread-resume",
  "concurrent-decision", "receipt-retry", "unknown-external-receipt",
] as const;
export const repositoryRoot = resolve(import.meta.dir, "..");
const fixtureDirectory = "specs/004-OutcomeGo整体项目/docs/fixtures";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string");
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export interface ParentFixture {
  schemaVersion: 1;
  fixtureId: string;
  fictional: true;
  parentScenarios: string[];
  input: ObjectValue;
  initialState: ObjectValue;
  requests: ObjectValue[];
  expectedStates: Array<{ entity: string; values: string[] }>;
  idRelations: string[];
  notificationCategories: string[];
  assertions: string[];
  cleanup: { scope: string; preserveSourceInputs: true; remove: string[] };
}

/** Validate executable inputs without claiming their expected business outcomes have occurred. */
export function validateParentFixture(value: unknown, expectedId: string, states: Record<string, readonly string[]>): ParentFixture {
  requireValue(object(value), `${expectedId}: fixture must be an object`);
  requireValue(value.schemaVersion === 1 && value.fixtureId === expectedId && value.fictional === true, `${expectedId}: fixture identity/version must be explicit and fictional`);
  requireValue(strings(value.parentScenarios) && value.parentScenarios.length && value.parentScenarios.every(entry => /^[A-H]$/.test(entry)), `${expectedId}: missing parent scenario coverage`);
  requireValue(object(value.input) && Object.keys(value.input).length && object(value.initialState), `${expectedId}: missing initial input/state`);
  requireValue(Array.isArray(value.requests) && value.requests.length && value.requests.every(step => object(step) && (typeof step.action === "string" || (typeof step.method === "string" && typeof step.path === "string"))), `${expectedId}: missing request/action sequence`);
  requireValue(Array.isArray(value.expectedStates) && value.expectedStates.length, `${expectedId}: missing expected states`);
  for (const sequence of value.expectedStates) {
    requireValue(object(sequence) && typeof sequence.entity === "string" && strings(sequence.values) && sequence.values.length, `${expectedId}: malformed state sequence`);
    const known = states[sequence.entity];
    requireValue(known && sequence.values.every(state => known.includes(state)), `${expectedId}: unknown ${sequence.entity} state`);
  }
  requireValue(strings(value.idRelations) && value.idRelations.length && value.idRelations.every(entry => /^[\w.[\]]+=[\w.[\]]+$/.test(entry)), `${expectedId}: missing ID relationships`);
  requireValue(strings(value.notificationCategories) && value.notificationCategories.every(entry => ["decision_pending", "acceptance_pending", "human_action_pending", "completed"].includes(entry)), `${expectedId}: invalid notification category`);
  requireValue(strings(value.assertions) && value.assertions.length, `${expectedId}: missing assertions`);
  requireValue(object(value.cleanup) && value.cleanup.scope === "fixture-created-bot" && value.cleanup.preserveSourceInputs === true && strings(value.cleanup.remove) && value.cleanup.remove.length, `${expectedId}: cleanup must stay within its own fixture`);
  const inspect = (entry: unknown) => {
    if (Array.isArray(entry)) { entry.forEach(inspect); return; }
    if (!object(entry)) return;
    for (const [key, child] of Object.entries(entry)) {
      requireValue(!/^(?:passw[o]rd|token|apiKey|privateKey|authorization|databaseUrl)$/i.test(key), `${expectedId}: credentials do not belong in fixed fixtures`);
      inspect(child);
    }
  };
  inspect(value);
  return value as unknown as ParentFixture;
}

const literalArray = (source: string, name: string) => {
  const body = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(source)?.[1];
  requireValue(body !== undefined, `Missing contract array ${name}`);
  return [...body.matchAll(/["']([^"']+)["']/g)].map(match => match[1]!);
};
const block = (source: string, kind: "enum" | "model", name: string) => {
  const body = new RegExp(`\\b${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1];
  requireValue(body !== undefined, `Missing Prisma ${kind} ${name}`);
  return body;
};
const enumValues = (source: string, name: string) => block(source, "enum", name).split("\n")
  .map(line => line.replace(/\/\/.*$/, "").trim()).filter(line => line && !line.startsWith("@@")).map(line => line.split(/\s+/)[0]!);
const equalValues = (a: readonly string[], b: readonly string[]) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

export async function checkOutcomeContracts(root = repositoryRoot) {
  const read = (path: string) => readFile(resolve(root, path), "utf8");
  const [contracts, inbox, schema, parentDesign] = await Promise.all([
    read("packages/contracts/src/outcomes.ts"), read("packages/contracts/src/outcome-inbox.ts"),
    read("packages/db/prisma/schema.prisma"),
    read("specs/004-OutcomeGo整体项目/design.md"),
  ]);
  const states = {
    outcome: literalArray(contracts, "OUTCOME_STATUSES"),
    agent: literalArray(contracts, "AGENT_WORK_ITEM_STATUSES"),
    human: literalArray(contracts, "HUMAN_WORK_ITEM_STATUSES"),
    decision: literalArray(inbox, "DECISION_STATUSES"),
    install: ["empty", "validated", "imported", "readable"],
    release: ["candidate", "verified", "pending-external-acceptance"],
  };
  const parity: Array<[string, string[]]> = [
    ["OutcomeStatus", states.outcome],
    ["OutcomeContractRevisionStatus", literalArray(contracts, "CONTRACT_REVISION_STATUSES")],
    ["OutcomeWorkItemStatus", [...states.agent, ...states.human]],
    ["OutcomeWorkItemKind", literalArray(contracts, "WORK_ITEM_KINDS")],
    ["OutcomeReviewResult", literalArray(contracts, "REVIEW_RESULTS")],
    ["OutcomeOutputKind", literalArray(contracts, "OUTPUT_KINDS")],
    ["OutcomeDecisionStatus", states.decision],
  ];
  for (const [name, values] of parity) requireValue(equalValues(enumValues(schema, name), values), `${name}: contract/persistence enum mismatch`);
  const topics = literalArray(contracts, "OUTCOME_EVENT_TOPICS");
  const catalog = parentDesign.split("## 14.")[1]?.split("## 15.")[0] ?? "";
  const documented = [...catalog.matchAll(/\|\s*`(outcome\.[^`]+)`\s*\|/g)].map(match => match[1]!);
  requireValue(equalValues(topics, documented), "Parent event catalog and contract topics disagree");
  for (const forbidden of ["OutcomeCheckpoint", "OutcomeRunLink", "OutcomeInboxItem"]) requireValue(!schema.includes(`model ${forbidden} {`), `Unexpected duplicate facts model ${forbidden}`);
  requireValue(/\boutcomeWorkItemId\s+String\?/.test(block(schema, "model", "Run")), "Existing Runs must retain a nullable Outcome association");
  const workItem = block(schema, "model", "OutcomeWorkItem");
  requireValue(/\brootRunId\s+String\?\s+@unique/.test(workItem), "WorkItem root Run identity must stay optional and unique");
  requireValue(/dedupeKey\s+String\s+@unique/.test(block(schema, "model", "OutcomeOutput")), "Output dedupe must remain a database constraint");
  for (const name of ["Outcome", "OutcomeContractRevision", "OutcomeAcceptanceCriterion", "OutcomeWorkItem", "OutcomeOutput", "OutcomeEvidence", "OutcomeReview", "OutcomeDecision", "OutcomeHumanActionCard", "OutcomeHumanReceipt"]) {
    const model = block(schema, "model", name);
    requireValue(/@@map\("outcomego_[^"]+"\)/.test(model), `${name}: missing physical table mapping`);
    if (name !== "Outcome") requireValue(/@relation\(/.test(model), `${name}: missing relational provenance`);
    for (const line of model.split("\n").filter(line => line.includes("@relation(") && line.includes("fields:"))) {
      const target = /^\s*\w+\s+(\w+)\??/.exec(line)?.[1];
      const fields = /fields:\s*\[([^\]]+)\]/.exec(line)?.[1]?.split(",").map(value => value.trim()) ?? [];
      const references = /references:\s*\[([^\]]+)\]/.exec(line)?.[1]?.split(",").map(value => value.trim()) ?? [];
      requireValue(target && fields.length && fields.length === references.length, `${name}: invalid relation declaration`);
      const referencedModel = block(schema, "model", target);
      for (const field of fields) requireValue(new RegExp(`\\b${field}\\s+`).test(model), `${name}: missing relation scalar ${field}`);
      for (const field of references) requireValue(new RegExp(`\\b${field}\\s+`).test(referencedModel), `${name}: missing target ${target}.${field}`);
    }
  }
  const fixtures = await Promise.all(PARENT_FIXTURES.map(async name => validateParentFixture(JSON.parse(await read(`${fixtureDirectory}/${name}.json`)), name, states)));
  const faultFixture = fixtures.find(fixture => fixture.fixtureId === "duplicate-event")!;
  requireValue(strings(faultFixture.input.scenarios) && equalValues(faultFixture.input.scenarios, [...RECOVERY_SCENARIOS]), "Both receipt-retry and unknown-external-receipt must be listed with all recovery scenarios");
  const sources: string[] = [];
  const collect = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) sources.push(path);
    }
  };
  for (const directory of ["apps/server/src", "apps/worker/src", "packages/messaging/src"]) await collect(resolve(root, directory));
  const occurrences: Array<{ file: string; line: number; topic: string }> = [];
  for (const path of sources) {
    const source = await readFile(path, "utf8");
    for (const pattern of [
      /\btopic\s*:\s*["'](outcome\.[^"']+)["']/g,
      /\bappend(?:Outcome)?Event(?:<[^>]+>)?\(\s*[^,]+,\s*["'](outcome\.[^"']+)["']/g,
      /\btopic\s*(?:===|!==)\s*["'](outcome\.[^"']+)["']/g,
    ]) for (const match of source.matchAll(pattern)) {
      const topic = match[1]!;
      const file = relative(root, path);
      const line = source.slice(0, match.index).split("\n").length;
      requireValue(topics.includes(topic), `${file}:${line}: unregistered event ${topic}`);
      occurrences.push({ file, line, topic });
    }
  }
  return { status: "PASS" as const, mode: "static-only" as const, fixtureIds: fixtures.map(fixture => fixture.fixtureId), enumCount: parity.length, topicCount: topics.length, occurrences, runtimeReplay: "PENDING" as const };
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await checkOutcomeContracts(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Outcome contract check failed"); process.exitCode = 1; }
}
