import { useMemo, useRef, useState } from "react";
import type { ExploreIdeaView } from "@outcomego/contracts/explore";
import { mentionHandleFor, type MentionOption } from "../../../../lib/mentions";
import { useI18n } from "../../../../lib/i18n";
import { MentionEditor } from "../../mention-editor";
import { OutcomeButton } from "../outcome-ui";
import { OutcomeRequestIds } from "../planning/outcome-client";
import type { OutcomeExecutionBot } from "../outcome-execution-card";
import type { ExploreClient } from "./explore-api";
import { quickIdeaDraft } from "./explore-state";

/** The whole "record an idea" UI: one text box; `@Bot` chooses who runs it, otherwise the main Bot. */
export function QuickIdeaForm({
  client,
  bots,
  onSaved,
  onCancel,
}: {
  client: Pick<ExploreClient, "create">;
  bots: readonly OutcomeExecutionBot[];
  onSaved: (idea: ExploreIdeaView) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const ids = useRef(new OutcomeRequestIds());
  const inFlight = useRef(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo<MentionOption[]>(
    () =>
      bots.map((bot) => ({
        id: bot.id,
        label: bot.name,
        handle: mentionHandleFor(bot.name),
        kind: "bot",
        color: bot.color,
        icon: bot.icon,
        hasAvatar: bot.hasAvatar,
        updatedAt: bot.updatedAt,
      })),
    [bots]
  );
  const draft = quickIdeaDraft(text, bots);
  async function submit() {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const input = { ...draft, status: "draft" as const };
    try {
      const idea = await client.create({
        ...input,
        clientRequestId: ids.current.for("create", input),
      });
      ids.current.complete("create");
      setText("");
      onSaved(idea);
    } catch {
      setError("Could not save this idea. Your input was kept. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="outcome-quick-idea space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div
        className="rounded-xl bg-field px-3 py-2.5 shadow-[inset_0_0_0_0.5px_var(--input)] focus-within:shadow-[inset_0_0_0_0.5px_var(--ring)]"
        onClick={() => editorRef.current?.focus()}
      >
        <MentionEditor
          className="max-h-60 min-h-[88px] w-full overflow-y-auto bg-transparent text-[14px] leading-6 outline-none"
          disabled={busy}
          editorRef={editorRef}
          onChange={(plainText) => setText(plainText)}
          onEscape={onCancel}
          onSubmit={() => void submit()}
          options={options}
          placeholder={t("What do you want to do? Type @ to choose a Bot.")}
          value={text}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(error)}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-foreground-secondary">
          {t("Without an @, the main Bot will run it.")}
        </span>
        <OutcomeButton variant="default" type="submit" disabled={!draft || busy}>
          {t("Save idea")}
        </OutcomeButton>
      </div>
    </form>
  );
}
