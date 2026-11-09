import { createPluginTemplate, type PluginTemplateMode } from "@aiteamos/plugin-sdk/templates";
import type { PluginDraftView, PluginManagementView } from "@aiteamos/contracts/plugin-management";
import { pluginIconUrl } from "@aiteamos/plugin-sdk";
import { PluginMark } from "./plugin-mark";
import { useRef, useState } from "react";
import { api } from "../../../client/aiteamos-api";
import { useI18n } from "../../../lib/i18n";
import {
  downloadPlugin,
  inputClass,
  PluginButton,
  PluginField,
  PluginSelect,
  usePluginOperation,
} from "./plugin-ui";

export function PackageStudio({
  data,
  refresh,
}: {
  data: PluginManagementView;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PluginTemplateMode>("skills");
  const [selected, setSelected] = useState<PluginDraftView | null>(null);
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [removeArmed, setRemoveArmed] = useState(false);
  const archive = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const operation = usePluginOperation(refresh);
  const select = (draft: PluginDraftView) => {
    setSelected(draft);
    setText(JSON.stringify(draft.definition, null, 2));
    setRemoveArmed(false);
  };
  const upload = async (files: FileList | null, directory: boolean) => {
    if (!files?.length) return;
    await operation.run(async () => {
      if (!directory && files[0]!.name.endsWith(".zip"))
        select(await api.importPluginArchive(new Uint8Array(await files[0]!.arrayBuffer())));
      else {
        const entries: Record<string, Uint8Array> = {};
        for (const file of Array.from(files)) {
          const path = directory
            ? file.webkitRelativePath.split("/").slice(1).join("/")
            : file.name;
          if (path.split("/").some((part) => ["node_modules", ".git", ".DS_Store"].includes(part)))
            continue;
          entries[path] = new Uint8Array(await file.arrayBuffer());
        }
        const { archivePackageFiles } = await import("@aiteamos/plugin-sdk/archive");
        select(await api.importPluginArchive(archivePackageFiles(entries)));
      }
    }, t("Package loaded and validated."));
  };
  return (
    <div className="grid gap-5">
      {operation.feedback}
      <div>
        <h1 tabIndex={-1} className="text-[16px] font-medium">
          {t("Develop plugins")}
        </h1>
        <p className="mt-1 text-[12px] leading-5 text-foreground-secondary">
          {t(
            "Load a package, preview its setup, test an installation, and export a bundle for others. Drafts and installed packages are separate."
          )}
        </p>
      </div>
      <PluginField label={t("Plugin type")}>
        <PluginSelect<PluginTemplateMode>
          label={t("Plugin type")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "skills", label: t("Skills") },
            { value: "remote-mcp", label: t("Remote MCP") },
            { value: "packaged-mcp", label: t("Packaged MCP") },
            { value: "hybrid", label: t("Hybrid skills + packaged MCP") },
          ]}
        />
      </PluginField>
      <div className="flex flex-wrap gap-2">
        <PluginButton
          disabled={operation.busy}
          onClick={() =>
            void operation.run(async () =>
              select(
                await api.importPluginFiles({
                  "plugin.json": JSON.stringify(
                    createPluginTemplate(mode, `my-plugin-${Date.now().toString(36)}`)
                  ),
                })
              )
            )
          }
        >
          {t("Create plugin")}
        </PluginButton>
        <PluginButton disabled={operation.busy} onClick={() => folder.current?.click()}>
          {t("Load / reload folder")}
        </PluginButton>
        <PluginButton disabled={operation.busy} onClick={() => archive.current?.click()}>
          {t("Import ZIP or manifest")}
        </PluginButton>
      </div>
      <input
        hidden
        ref={archive}
        type="file"
        accept=".zip,.json"
        onChange={(event) => {
          void upload(event.target.files, false);
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={folder}
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          void upload(event.target.files, true);
          event.target.value = "";
        }}
      />
      <PluginField label={t("Repository, release ZIP, or manifest URL")}>
        <div className="flex gap-2">
          <input
            className={inputClass}
            placeholder="https://github.com/owner/plugin"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
          <PluginButton
            disabled={operation.busy || !source}
            onClick={() =>
              void operation.run(
                async () => select(await api.importPluginUrl(source)),
                t("Package fetched and validated.")
              )
            }
          >
            {t("Load URL")}
          </PluginButton>
        </div>
      </PluginField>
      <div className="flex flex-wrap gap-2">
        {data.drafts.map((draft) => (
          <PluginButton
            key={draft.id}
            primary={selected?.id === draft.id}
            onClick={() => select(draft)}
          >
            <span className="flex items-center gap-2">
              <PluginMark name={draft.name} logoUrl={pluginIconUrl(draft.definition)} size="xs" />
              {draft.name}
            </span>
          </PluginButton>
        ))}
      </div>
      {selected && (
        <>
          <div className="rounded-xl bg-black/5 p-4 dark:bg-white/5">
            <div className="flex items-center gap-3">
              <PluginMark
                name={selected.definition.name}
                logoUrl={pluginIconUrl(selected.definition)}
              />
              <p className="font-medium">
                {selected.definition.name} · {selected.definition.version}
              </p>
            </div>
            <p className="mt-1 text-sm">
              {t("{connectors} connectors · {skills} skills", {
                connectors: selected.definition.connections.length,
                skills: selected.definition.skills.length,
              })}
            </p>
            {selected.warnings.map((warning) => (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" key={warning}>
                {warning}
              </p>
            ))}
            {selected.definition.connections.map((connection) => (
              <div key={connection.key} className="mt-3 text-sm">
                <strong>{connection.name}</strong> · {connection.transport} · {connection.auth}
                <p className="text-foreground-secondary">
                  {connection.setup?.description ??
                    t("Users configure and connect this connector from Installed plugins.")}
                </p>
              </div>
            ))}
          </div>
          <PluginField
            label={t("Package definition")}
            help={t(
              "Edit metadata, connectors, setup fields, skills, and supporting files. Save validates the package without changing an installed version."
            )}
          >
            <textarea
              aria-label={t("Package definition")}
              spellCheck={false}
              className={`${inputClass} min-h-80 font-mono text-xs`}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </PluginField>
          <div className="flex flex-wrap gap-2">
            <PluginButton
              disabled={operation.busy}
              primary
              onClick={() =>
                void operation.run(
                  async () => select(await api.savePluginDraft(selected.id, JSON.parse(text))),
                  t("Valid package. Changes saved.")
                )
              }
            >
              {t("Validate and save")}
            </PluginButton>
            <PluginButton
              disabled={operation.busy}
              onClick={() =>
                void operation.run(
                  () => api.installPluginDraft(selected.id),
                  t("Installed. Open Installed to configure its accounts and test its connections.")
                )
              }
            >
              {t("Install for testing")}
            </PluginButton>
            <PluginButton
              disabled={operation.busy}
              onClick={() =>
                void operation.run(() => downloadPlugin(selected.id, true), t("Package exported."))
              }
            >
              {t("Export ZIP")}
            </PluginButton>
            <PluginButton
              disabled={operation.busy}
              onClick={() =>
                removeArmed
                  ? void operation.run(async () => {
                      await api.deletePluginDraft(selected.id);
                      setSelected(null);
                    })
                  : setRemoveArmed(true)
              }
            >
              {removeArmed ? t("Confirm delete draft") : t("Delete draft")}
            </PluginButton>
          </div>
        </>
      )}
      <aside className="border-t border-black/10 pt-4 text-[12px] leading-5 text-foreground-secondary dark:border-white/10">
        <p>
          {t("Contributions belong in")} <code>packages/plugins/&lt;plugin-name&gt;/</code>
          {t(
            ". Most plugins need only a manifest and skill files. A connector implementation can keep its dependencies inside its own package."
          )}
        </p>
        <p className="mt-2">
          {t(
            "Export the validated bundle, add its files using GitHub’s web editor, and open a pull request. Include setup instructions and the connection tests you ran. Saved account credentials are never added to an exported installation."
          )}
        </p>
      </aside>
    </div>
  );
}
