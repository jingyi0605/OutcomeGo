import { TodoAutoAcceptRuleCreate, type TodoAutoAcceptRuleView } from "@outcomego/contracts/todo";
import { useEffect, useState, type FormEvent } from "react";
import type { TodoAutoAcceptRulesClient } from "../../../client/todo-api";
import { useI18n } from "../../../lib/i18n";
import { SettingsGroup, settingsInput, settingsSecondaryButton } from "./ui";

type Draft = { name: string; routineId: string; botId: string; sourceKind: string };
const blank: Draft = { name: "", routineId: "", botId: "", sourceKind: "" };

function RuleForm({ rule, onSave, onCancel, saving }: {
  rule: TodoAutoAcceptRuleView | null;
  onSave: (input: TodoAutoAcceptRuleCreate) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => rule ? {
    name: rule.name, routineId: rule.routineId ?? "", botId: rule.botId ?? "", sourceKind: rule.sourceKind ?? "",
  } : blank);
  const [invalid, setInvalid] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const input = TodoAutoAcceptRuleCreate.safeParse({
      name: draft.name, routineId: draft.routineId.trim() || null, botId: draft.botId.trim() || null,
      sourceKind: draft.sourceKind.trim() || null,
    });
    setInvalid(!input.success);
    if (input.success) onSave(input.data);
  }
  const field = (key: keyof Draft, label: string) => (
    <label className="grid gap-1 text-xs text-foreground-secondary">
      {label}
      <input type="text" aria-label={label} className={settingsInput} value={draft[key]} disabled={saving}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
    </label>
  );
  return (
    <form onSubmit={submit} className="grid gap-2 px-3 py-3">
      {field("name", t("Rule name"))}
      {field("routineId", t("Routine ID"))}
      {field("botId", t("Bot ID"))}
      {field("sourceKind", t("Source type (optional)"))}
      {invalid && <p role="alert" className="text-xs text-destructive">{t("Enter a rule name and a valid routine or bot ID.")}</p>}
      <div className="flex gap-2">
        <button type="submit" className={settingsSecondaryButton} disabled={saving}>{t("Save")}</button>
        <button type="button" className={settingsSecondaryButton} disabled={saving} onClick={onCancel}>{t("Cancel")}</button>
      </div>
    </form>
  );
}

export function TodoAutoAcceptRules({ client, disabled = false }: { client: TodoAutoAcceptRulesClient; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const [rules, setRules] = useState<TodoAutoAcceptRuleView[] | null>(null);
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<TodoAutoAcceptRuleView | "new" | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) return;
    let current = true;
    setError(null);
    void client.list().then(({ rules }) => {
      if (current) setRules(rules);
    }).catch(() => {
      if (current) setError("Could not load auto-accept rules. Try again.");
    });
    return () => { current = false; };
  }, [client, disabled, version]);

  const write = async (action: () => Promise<void>) => {
    if (disabled || saving) return;
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch {
      setError("Could not save the auto-accept rule. Try again.");
    } finally {
      setSaving(false);
    }
  };
  const merge = (rule: TodoAutoAcceptRuleView) => setRules((previous) =>
    previous?.some((item) => item.id === rule.id)
      ? previous.map((item) => item.id === rule.id ? rule : item)
      : [...(previous ?? []), rule]);
  const saveRule = (input: TodoAutoAcceptRuleCreate) => void write(async () => {
    if (!editor) return;
    const saved = editor === "new" ? await client.create(input) : await client.update(editor.id, input);
    merge(saved);
    setEditor(null);
  });

  return (
    <SettingsGroup>
      <div className="space-y-3 px-3 py-3 text-xs">
        <p className="text-foreground-secondary">{t("Matching suggestions become to-dos without review. Add rules for routines or bots you trust.")}</p>
        {error && <p role="alert" className="text-destructive">{t(error)}</p>}
        {!rules && error && <button type="button" className={settingsSecondaryButton} onClick={() => setVersion((value) => value + 1)}>{t("Retry")}</button>}
        {!disabled && !rules && !error && <p role="status">{t("Loading…")}</p>}
        {rules?.length === 0 && <p>{t("No auto-accept rules yet.")}</p>}
        {rules && rules.length > 0 && <ul className="divide-y divide-border">
          {rules.map((rule) => <li key={rule.id} className="space-y-2 py-2">
            <p className="break-words font-semibold">{rule.name}</p>
            <p className="break-all text-foreground-secondary">{[
              rule.routineId && `${t("Routine ID")}: ${rule.routineId}`,
              rule.botId && `${t("Bot ID")}: ${rule.botId}`,
              rule.sourceKind && `${t("Source type")}: ${rule.sourceKind}`,
            ].filter(Boolean).join(" · ")}</p>
            <p className="text-foreground-secondary">
              {t("{count} matches", { count: rule.matchCount })} · {rule.lastMatchedAt
                ? t("Last match: {time}", { time: new Date(rule.lastMatchedAt).toLocaleString(locale) }) : t("No matches yet")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={settingsSecondaryButton} disabled={saving || editor !== null}
                onClick={() => void write(async () => merge(await client.update(rule.id, { enabled: !rule.enabled })))}>
                {rule.enabled ? t("Disable rule") : t("Enable rule")}
              </button>
              <button type="button" className={settingsSecondaryButton} disabled={saving || editor !== null} onClick={() => setEditor(rule)}>{t("Edit rule")}</button>
              {deleting === rule.id ? <>
                <button type="button" className={settingsSecondaryButton} disabled={saving} onClick={() => void write(async () => {
                  await client.remove(rule.id);
                  setRules((previous) => previous?.filter((item) => item.id !== rule.id) ?? []);
                  setDeleting(null);
                })}>{t("Confirm rule deletion")}</button>
                <button type="button" className={settingsSecondaryButton} disabled={saving} onClick={() => setDeleting(null)}>{t("Cancel")}</button>
              </> : <button type="button" className={settingsSecondaryButton} disabled={saving || editor !== null} onClick={() => setDeleting(rule.id)}>{t("Delete rule")}</button>}
            </div>
          </li>)}
        </ul>}
        {rules && !editor && <button type="button" className={settingsSecondaryButton} disabled={saving} onClick={() => setEditor("new")}>{t("New auto-accept rule")}</button>}
      </div>
      {editor && <RuleForm key={editor === "new" ? editor : editor.id} rule={editor === "new" ? null : editor} onSave={saveRule} onCancel={() => setEditor(null)} saving={saving} />}
    </SettingsGroup>
  );
}
