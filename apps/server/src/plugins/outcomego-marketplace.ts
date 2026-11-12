import { clonePluginDefinition, type PluginDefinition, validatePluginCatalog } from "@outcomego/plugin-sdk";
import { pluginCatalog } from "@outcomego/plugins";

type JsonObject = Record<string, unknown>;

export interface OutcomeGoMarketplaceManifest {
  schemaVersion: 1;
  revision: string;
  plugins: readonly PluginDefinition[];
}

const objectValue = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const isPluginDefinition = (value: unknown): value is PluginDefinition => {
  const plugin = objectValue(value);
  return (
    typeof plugin.key === "string" &&
    typeof plugin.version === "string" &&
    typeof plugin.name === "string" &&
    typeof plugin.description === "string" &&
    typeof plugin.publisher === "string" &&
    typeof plugin.category === "string" &&
    typeof plugin.featured === "boolean" &&
    Array.isArray(plugin.components) &&
    Array.isArray(plugin.connections) &&
    Array.isArray(plugin.skills)
  );
};

export const bundledOutcomeGoMarketplace: OutcomeGoMarketplaceManifest = {
  schemaVersion: 1,
  revision: "2026.10.28.1",
  plugins: pluginCatalog,
};

/**
 * Parse the deployment-owned OutcomeGo marketplace format.
 *
 * The manifest is intentionally just JSON: self-hosters can mount a registry file without
 * running another service. Installed packages remain pinned because PluginService stores the
 * complete normalized plugin definition on installation.
 */
export const parseOutcomeGoMarketplace = (value: unknown): OutcomeGoMarketplaceManifest => {
  const manifest = objectValue(value);
  if (manifest.schemaVersion !== 1) {
    throw new Error("OutcomeGo marketplace schemaVersion must be 1");
  }
  if (typeof manifest.revision !== "string" || !manifest.revision.trim()) {
    throw new Error("OutcomeGo marketplace revision is required");
  }
  if (!Array.isArray(manifest.plugins) || !manifest.plugins.every(isPluginDefinition)) {
    throw new Error("OutcomeGo marketplace plugins are invalid");
  }
  const plugins = (manifest.plugins as PluginDefinition[]).map(clonePluginDefinition);
  validatePluginCatalog(plugins);
  return {
    schemaVersion: 1,
    revision: manifest.revision,
    plugins,
  };
};

export class OutcomeGoMarketplaceSource {
  private snapshot: Promise<OutcomeGoMarketplaceManifest> | null = null;

  constructor(
    private readonly manifestPath = process.env.OUTCOMEGO_MARKETPLACE_FILE?.trim() || null,
    private readonly bundledManifest: OutcomeGoMarketplaceManifest = bundledOutcomeGoMarketplace
  ) {}

  async manifest(): Promise<OutcomeGoMarketplaceManifest> {
    if (this.snapshot) return this.snapshot;
    this.snapshot = this.load();
    return this.snapshot;
  }

  async plugins(): Promise<PluginDefinition[]> {
    const manifest = await this.manifest();
    return manifest.plugins.map((plugin) => ({
      ...clonePluginDefinition(plugin),
      sourceRevision: plugin.sourceRevision ?? manifest.revision,
    }));
  }

  private async load(): Promise<OutcomeGoMarketplaceManifest> {
    if (!this.manifestPath) return parseOutcomeGoMarketplace(this.bundledManifest);
    const file = Bun.file(this.manifestPath);
    if (!(await file.exists())) {
      throw new Error(`OutcomeGo marketplace file does not exist: ${this.manifestPath}`);
    }
    return parseOutcomeGoMarketplace(await file.json());
  }
}
