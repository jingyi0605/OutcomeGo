import type { PluginManagementView, SavedSkillView } from "@outcomego/contracts/plugin-management";
import { useRef, useState } from "react";
import { api } from "../../../client/outcomego-api";
import { useI18n } from "../../../lib/i18n";
import { inputClass, PluginButton, PluginField, usePluginOperation } from "./plugin-ui";

export function PrivateSkills({
  data,
  refresh,
}: {
  data: PluginManagementView;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<SavedSkillView | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState("{}");
  const [armed, setArmed] = useState(false);
  const operation = usePluginOperation(refresh);
  const importInput = useRef<HTMLInputElement>(null);
  const edit = (skill: SavedSkillView | null) => {
    setSelected(skill);
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setBody(skill?.body ?? "");
    setFiles(JSON.stringify(skill?.files ?? {}, null, 2));
    setEditing(true);
    setArmed(false);
  };
  return (
    <div className="grid gap-5">
      {operation.feedback}
      <div className="flex items-center justify-between">
        <div>
          <h1 tabIndex={-1} className="text-[16px] font-medium">
            {t("Private skills")}
          </h1>
          <p className="text-[12px] leading-5 text-foreground-secondary">
            {t(
              "Instructions and supporting files stored on your server. Every Bot can use these skills, and Bots can add their own."
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PluginButton onClick={() => importInput.current?.click()}>
            {t("Import SKILL.md")}
          </PluginButton>
          <PluginButton onClick={() => edit(null)}>{t("Create skill")}</PluginButton>
        </div>
      </div>
      <div className="grid gap-2">
        {data.skills.map((skill) => (
          <button
            type="button"
            onClick={() => edit(skill)}
            key={skill.id}
            className="plugin-management-card cursor-pointer px-3.5 py-3 text-left transition-colors hover:bg-[#7777772b]"
          >
            <p className="font-medium">{skill.name}</p>
            <p className="text-[12px] leading-5 text-foreground-secondary">{skill.description}</p>
          </button>
        ))}
        {!data.skills.length && !editing && (
          <p className="py-8 text-center text-[12px] leading-5 text-foreground-secondary">
            {t("Create a skill or import a SKILL.md file to get started.")}
          </p>
        )}
      </div>
      <input
        ref={importInput}
        aria-label={t("Import SKILL.md")}
        hidden
        type="file"
        accept=".md"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void operation.run(async () => {
              const text = await file.text();
              edit(null);
              const { readSkillImport } = await import("./skill-import");
              const parsed = readSkillImport(text, file.name.replace(/\.md$/, ""));
              setName(parsed.name);
              setDescription(parsed.description);
              setBody(parsed.body);
            });
          event.target.value = "";
        }}
      />
      {editing && (
        <>
          <PluginField label={t("Skill name")}>
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </PluginField>
          <PluginField label={t("When to use it")}>
            <input
              className={inputClass}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </PluginField>
          <PluginField label={t("Instructions")}>
            <textarea
              className={`${inputClass} min-h-52`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </PluginField>
          <details className="animated-disclosure">
            <summary className="cursor-pointer text-sm">{t("Supporting files")}</summary>
            <PluginField
              label={t("Relative file paths and text content")}
              help='For example: {"references/style.md":"Your reference text"}'
            >
              <textarea
                className={`${inputClass} mt-3 font-mono text-xs`}
                rows={5}
                value={files}
                onChange={(event) => setFiles(event.target.value)}
              />
            </PluginField>
          </details>
          <div className="flex gap-2">
            <PluginButton
              primary
              disabled={operation.busy || !name.trim()}
              onClick={() =>
                void operation.run(async () => {
                  await api.savePluginSkill(selected?.id ?? null, {
                    name,
                    description,
                    body,
                    files: JSON.parse(files),
                  });
                  setEditing(false);
                }, t("Skill saved."))
              }
            >
              {t("Save skill")}
            </PluginButton>
            <PluginButton onClick={() => setEditing(false)}>{t("Cancel")}</PluginButton>
            {selected && (
              <PluginButton
                disabled={operation.busy}
                onClick={() =>
                  armed
                    ? void operation.run(async () => {
                        await api.deletePluginSkill(selected.id);
                        setEditing(false);
                      })
                    : setArmed(true)
                }
              >
                {armed ? t("Confirm delete skill") : t("Delete skill")}
              </PluginButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}
