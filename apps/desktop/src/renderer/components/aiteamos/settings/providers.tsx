import {
  RECOMMENDED_SEARCH_PROVIDER,
  WEB_PROVIDER_LISTS,
  type WebProviderInfo,
  type WebProviderState,
  type WebProvidersView,
  type WebTool,
  type WebToolInput,
  type WebToolStrategy,
} from "@aiteamos/contracts/web-search";
import { clientErrorMessage } from "@aiteamos/product-core/redaction";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleX,
  ExternalLink,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AnimatedCollapse } from "../../ui/animated-collapse";
import { LoadingOrb } from "../../ui/loading-orb";
import { api } from "../../../client/aiteamos-api";
import { cn } from "../../../lib/cn";
import { useI18n } from "../../../lib/i18n";
import { webProviderIcon as iconFor } from "../../../lib/web-provider-icons";
import {
  SettingsGroup,
  SettingsHeading,
  SettingsIntro,
  settingsPrimaryButton,
  settingsSecondaryButton,
  settingsInput,
  settingsRow,
} from "./ui";

const actionButton = settingsPrimaryButton;
const secondaryButton = settingsSecondaryButton;
const inputClass = `${settingsInput} w-[280px] max-w-full flex-1`;

const TOOL_COPY: Record<WebTool, { title: string; description: string; off: string }> = {
  search: {
    title: "Search",
    description: "How bots find information on the web.",
    off: "Bots can't search the web.",
  },
  fetch: {
    title: "Fetch",
    description: "How bots read a web page without opening their browser.",
    off: "Bots can only read pages in their browser.",
  },
};

type Tone = "ok" | "warn" | "error" | "neutral";
const toneClass: Record<Tone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  neutral: "text-foreground-tertiary",
};

function Status({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  const Icon =
    tone === "ok"
      ? CircleCheck
      : tone === "error"
        ? CircleX
        : tone === "warn"
          ? TriangleAlert
          : null;
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 text-[11.5px]", toneClass[tone])}
      title={title}
    >
      {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={2} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A provider logo, or the Off symbol in a tile of the same size so names line up. */
function ProviderIcon({ info, size = "size-5" }: { info?: WebProviderInfo; size?: string }) {
  const icon = info && iconFor(info.brand);
  if (icon) return <img alt="" className={cn(size, "shrink-0 rounded-[5px]")} src={icon} />;
  return (
    <span
      className={cn(size, "grid shrink-0 place-items-center rounded-[5px] bg-[#8e8e93] text-white")}
    >
      <Ban className="size-[70%]" strokeWidth={2.4} />
    </span>
  );
}

const ago = (iso: string, t: (key: string, values?: Record<string, string | number>) => string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1
    ? t("just now")
    : minutes < 60
      ? t("{count} min ago", { count: minutes })
      : minutes < 1_440
        ? t("{count} h ago", { count: Math.round(minutes / 60) })
        : new Date(iso).toLocaleDateString();
};

function providerStatus(
  info: WebProviderInfo,
  state: WebProviderState | undefined,
  t: (key: string, values?: Record<string, string | number>) => string
) {
  const check = state?.check;
  if (check?.status === "passed")
    return (
      <Status tone="ok" title={`${check.message} · ${ago(check.checkedAt, t)}`}>
        {t("Checked")}
      </Status>
    );
  if (check?.status === "failed") return <Status tone="error">{t("Check failed")}</Status>;
  return (
    <Status tone="neutral">
      {state?.ready || !info.fields.length ? t("Not checked") : t("Add API key")}
    </Status>
  );
}

/** Why a tool needs attention: off, basic built-in fetch, or a failing check. */
function toolWarning(
  tool: WebTool,
  view: WebProvidersView,
  t: (key: string, values?: Record<string, string | number>) => string
): { tone: Tone; text: string } | null {
  const selected = view[tool].selected;
  if (!selected) return { tone: "warn", text: t(TOOL_COPY[tool].off) };
  const name =
    WEB_PROVIDER_LISTS[tool].find((provider) => provider.id === selected)?.name ?? selected;
  if (view[tool].providers[selected]?.check?.status === "failed")
    return { tone: "error", text: t("{name} failed its last check.", { name }) };
  if (tool === "fetch" && selected === "builtin")
    return { tone: "warn", text: t("Basic pages only; can't run JavaScript.") };
  return null;
}

export default function ProvidersSettings() {
  const { t } = useI18n();
  const contentId = useId();
  const [view, setView] = useState<WebProvidersView | null>(null);
  const [page, setPage] = useState<WebTool | null>(null);
  // Unsaved edits on the open page.
  const [draftProviders, setDraftProviders] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<WebToolStrategy>("failover");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [removals, setRemovals] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const resetDraft = (tool: WebTool | null, next: WebProvidersView | null) => {
    setDraftProviders(tool && next ? [...next[tool].schedule.providers] : []);
    setStrategy(tool && next ? next[tool].schedule.strategy : "failover");
    setTyped({});
    setRemovals(new Set());
  };

  useEffect(() => {
    let active = true;
    api
      .webProviders()
      .then((next) => active && setView(next))
      .catch((cause) => {
        if (!active) return;
        setError(clientErrorMessage(cause, t("Could not load provider settings")));
      })
      .finally(() => active && setBusy(null));
    return () => {
      active = false;
    };
  }, []);

  const openPage = (tool: WebTool | null) => {
    setPage(tool);
    resetDraft(tool, view);
    // With search off, the recommended provider opens ready for its key.
    setExpanded(
      new Set(
        tool === "search" && view && !view.search.schedule.providers.length ? [RECOMMENDED_SEARCH_PROVIDER] : []
      )
    );
    setError(null);
    setApplied(false);
  };

  const change: WebToolInput = {};
  if (view && page) {
    const original = view[page].schedule;
    if (strategy !== original.strategy || draftProviders.join("\u0000") !== original.providers.join("\u0000"))
      change.schedule = { strategy, providers: draftProviders };
    for (const info of WEB_PROVIDER_LISTS[page]) {
      const value = typed[info.id]?.trim();
      if (value) (change.providers ??= {})[info.id] = { apiKey: value };
      else if (removals.has(info.id)) (change.providers ??= {})[info.id] = { apiKey: null };
    }
  }
  const changed = Object.keys(change).length > 0;

  async function save() {
    if (!page) return false;
    setBusy("save");
    setError(null);
    try {
      const next = await api.updateWebProviders({ [page]: change });
      setView(next);
      resetDraft(page, next);
      setApplied(true);
      window.setTimeout(() => setApplied(false), 1_800);
      return true;
    } catch (cause) {
      setError(clientErrorMessage(cause, t("Could not save provider settings")));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function check(tool: WebTool, provider: string) {
    // The saved key is what gets checked; save pending edits first.
    if (changed && !(await save())) return;
    setBusy(`check:${provider}`);
    setError(null);
    try {
      setView(await api.checkWebProvider({ tool, provider }));
    } catch (cause) {
      setError(clientErrorMessage(cause, t("Could not run the check")));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const errorAlert = error ? (
    <div role="alert" className="mt-3 px-2 text-[12px] text-red-600 dark:text-red-400">
      {error}
    </div>
  ) : null;

  if (!page) {
    return (
      <>
        <SettingsHeading>{t("Providers")}</SettingsHeading>
        <SettingsIntro>
          {t("The services bots use to search the web and read pages.")}
        </SettingsIntro>
        <SettingsGroup className="px-0">
          {(["search", "fetch"] as const).map((tool) => {
            const active = view?.[tool].selected;
            const info = WEB_PROVIDER_LISTS[tool].find((provider) => provider.id === active);
            const warning = view ? toolWarning(tool, view, t) : null;
            return (
              <button
                className={cn(
                  settingsRow,
                  "w-full px-3.5 text-left outline-none hover:bg-black/[0.025] focus-visible:bg-black/[0.035] disabled:opacity-60 dark:hover:bg-white/[0.03]"
                )}
                data-settings-anchor={`web-${tool}-provider`}
                data-testid={`providers-${tool}`}
                disabled={!view}
                key={tool}
                onClick={() => openPage(tool)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[17px] text-foreground">
                    {t(TOOL_COPY[tool].title)}
                  </span>
                  <span className="mt-px block" data-testid={`${tool}-note`}>
                    {warning ? (
                      <Status tone={warning.tone}>{warning.text}</Status>
                    ) : (
                      <span className="text-[12px] text-foreground-secondary">
                        {t(TOOL_COPY[tool].description)}
                      </span>
                    )}
                  </span>
                </span>
                {view ? (
                  <span
                    className="flex shrink-0 items-center gap-2 text-[12.5px] text-foreground-secondary"
                    data-testid={`${tool}-provider`}
                  >
                    <ProviderIcon info={info} size="size-[18px]" />
                    <span>{info?.name ?? t("Off")}</span>
                  </span>
                ) : null}
                <ChevronRight
                  className="size-4 shrink-0 text-foreground-tertiary"
                  strokeWidth={1.8}
                />
              </button>
            );
          })}
        </SettingsGroup>
        {errorAlert}
      </>
    );
  }

  const tool = page;
  const selected = draftProviders[0] ?? null;
  const pending = view
    ? {
        ...view,
        [tool]: {
          ...view[tool],
          selected,
          schedule: { ...view[tool].schedule, strategy, providers: draftProviders },
        },
      }
    : null;
  const warning = pending ? toolWarning(tool, pending, t) : null;
  const orderedProviders = [...draftProviders, ...WEB_PROVIDER_LISTS[tool].map((info) => info.id)]
    .filter((id, index, all) => all.indexOf(id) === index)
    .map((id) => WEB_PROVIDER_LISTS[tool].find((info) => info.id === id))
    .filter((info): info is WebProviderInfo => Boolean(info));
  const radio = (id: string | null, label: string) => (
    <input
      aria-label={label}
      checked={selected === id}
      className="size-3.5 shrink-0 accent-black dark:accent-white"
      disabled={!view || Boolean(busy)}
      name={`web-${tool}`}
      onChange={() => id === null && setDraftProviders([])}
      type="radio"
    />
  );
  const checkbox = (id: string, label: string) => (
    <input
      aria-label={label}
      checked={draftProviders.includes(id)}
      className="size-3.5 shrink-0 accent-black dark:accent-white"
      disabled={!view || Boolean(busy)}
      onChange={(event) => {
        setDraftProviders((current) =>
          event.target.checked
            ? current.includes(id)
              ? current
              : [...current, id]
            : current.filter((provider) => provider !== id)
        );
      }}
      type="checkbox"
    />
  );

  const renderProvider = (info: WebProviderInfo) => {
    const state = view?.[tool].providers[info.id];
    const isSelected = draftProviders.includes(info.id);
    const position = draftProviders.indexOf(info.id);
    const removing = removals.has(info.id);
    const keyed = info.fields.length > 0;
    const missing = keyed && !typed[info.id]?.trim() && (!state?.secretSaved || removing);
    const open = keyed && (expanded.has(info.id) || (isSelected && missing));
    const failed = state?.check?.status === "failed" ? state.check.message : null;
    const label = (
      <>
        <ProviderIcon info={info} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-foreground">
            <span>{info.name}</span>
            {tool === "search" && info.id === RECOMMENDED_SEARCH_PROVIDER ? (
              <span className="rounded-[5px] bg-black/[0.06] px-1.5 py-px text-[10.5px] text-foreground-secondary dark:bg-white/[0.08]">
                {t("Recommended")}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              "block truncate text-[11.5px]",
              failed ? toneClass.error : "text-foreground-secondary"
            )}
            title={failed ?? undefined}
          >
            {failed ?? info.description}
          </span>
        </span>
        <span className="shrink-0">{providerStatus(info, state, t)}</span>
        {/* Fixed columns keep statuses and chevrons aligned, with or without a key field. */}
        {keyed ? (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-foreground-tertiary transition-transform duration-200 ease-out motion-reduce:transition-none",
              open && "rotate-90"
            )}
          />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
      </>
    );
    return (
      <div
        key={info.id}
        className="border-t border-black/[0.065] py-2 dark:border-white/[0.07]"
        data-testid={`provider-${tool}:${info.id}`}
      >
        <div className="settings-provider-header flex min-h-9 items-center gap-2.5">
          {checkbox(info.id, t("Use {name} for {tool}", { name: info.name, tool }))}
          {keyed ? (
            <button
              aria-expanded={open}
              aria-controls={`${contentId}-${tool}-${info.id}`}
              className="settings-provider-choice flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
              onClick={() => toggle(info.id)}
              type="button"
            >
              {label}
            </button>
          ) : (
            <span className="settings-provider-choice flex min-w-0 flex-1 items-center gap-2.5">
              {label}
            </span>
          )}
          {!missing ? (
            <button
              aria-label={t("Check {name} {tool}", { name: info.name, tool })}
              className={cn(secondaryButton, "settings-provider-check w-[72px] justify-center")}
              disabled={!view || Boolean(busy)}
              onClick={() => void check(tool, info.id)}
              type="button"
            >
              {busy === `check:${info.id}` ? <LoadingOrb aria-hidden size={14} /> : null}
              {t("Check")}
            </button>
          ) : (
            <span className="settings-provider-check w-[72px] shrink-0" />
          )}
          {isSelected ? (
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                aria-label={t("Move {name} up", { name: info.name })}
                className="rounded p-1 text-foreground-tertiary hover:text-foreground disabled:opacity-35"
                disabled={position <= 0 || Boolean(busy)}
                onClick={() =>
                  setDraftProviders((current) => {
                    const next = [...current];
                    [next[position - 1], next[position]] = [next[position]!, next[position - 1]!];
                    return next;
                  })
                }
                type="button"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                aria-label={t("Move {name} down", { name: info.name })}
                className="rounded p-1 text-foreground-tertiary hover:text-foreground disabled:opacity-35"
                disabled={position === -1 || position === draftProviders.length - 1 || Boolean(busy)}
                onClick={() =>
                  setDraftProviders((current) => {
                    const next = [...current];
                    [next[position], next[position + 1]] = [next[position + 1]!, next[position]!];
                    return next;
                  })
                }
                type="button"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </span>
          ) : null}
        </div>
        <AnimatedCollapse open={open} id={`${contentId}-${tool}-${info.id}`}>
          <div className="settings-provider-fields mt-2 space-y-2 pl-[54px]">
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={t("{name} {tool} API key", { name: info.name, tool })}
                autoComplete="new-password"
                className={inputClass}
                disabled={!view || Boolean(busy)}
                maxLength={20_000}
                onChange={(event) => {
                  const value = event.target.value;
                  setTyped((current) => ({ ...current, [info.id]: value }));
                  setRemovals((current) => {
                    const next = new Set(current);
                    next.delete(info.id);
                    return next;
                  });
                }}
                placeholder={state?.secretSaved && !removing ? t("Replace API key") : t("API key")}
                type="password"
                value={typed[info.id] ?? ""}
              />
              {state?.secretSaved ? (
                <button
                  className={secondaryButton}
                  disabled={!view || Boolean(busy)}
                  onClick={() => {
                    setTyped((current) => ({ ...current, [info.id]: "" }));
                    setRemovals((current) => {
                      const next = new Set(current);
                      removing ? next.delete(info.id) : next.add(info.id);
                      return next;
                    });
                  }}
                  type="button"
                >
                  {removing ? t("Keep") : t("Remove")}
                </button>
              ) : null}
              <span className="text-[11.5px] text-foreground-tertiary">
                {removing ? t("Will be removed") : state?.secretSaved ? t("Saved") : ""}
              </span>
            </div>
            {state?.check ? (
              <div
                className={cn(
                  "text-[11.5px]",
                  toneClass[state.check.status === "passed" ? "ok" : "error"]
                )}
              >
                {state.check.message} · {ago(state.check.checkedAt, t)}
              </div>
            ) : null}
            {isSelected && missing ? (
              <div className={cn("text-[11.5px]", toneClass.warn)}>
                {t("Add the API key to use {name} for {tool}.", { name: info.name, tool })}
              </div>
            ) : null}
            {info.setupUrl ? (
              <button
                className="inline-flex items-center gap-1 text-[11.5px] text-foreground-secondary underline underline-offset-2"
                onClick={() => window.open(info.setupUrl, "_blank", "noopener,noreferrer")}
                type="button"
              >
                {t("Get a key")} <ExternalLink className="size-3" />
              </button>
            ) : null}
          </div>
        </AnimatedCollapse>
      </div>
    );
  };

  return (
    <section aria-label={t("{tool} providers", { tool: TOOL_COPY[tool].title })}>
      <SettingsHeading anchor={`web-${tool}-provider`}>
        <button
          aria-label={t("Back to Providers")}
          className="text-foreground-tertiary outline-none hover:text-foreground focus-visible:underline"
          onClick={() => openPage(null)}
          type="button"
        >
          {t("Providers")}
        </button>
        <ChevronRight
          className="mx-1 inline size-4 align-[-2px] text-foreground-tertiary"
          strokeWidth={1.8}
        />
        {t(TOOL_COPY[tool].title)}
      </SettingsHeading>
      <SettingsIntro className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span>{t(TOOL_COPY[tool].description)}</span>
        {warning ? (
          <span data-testid={`${tool}-warning`}>
            <Status tone={warning.tone}>{warning.text}</Status>
          </span>
        ) : null}
      </SettingsIntro>
      <SettingsGroup>
        <div className="flex min-h-[52px] items-center gap-2.5 py-2">
          {radio(null, t("Turn {tool} off", { tool }))}
          <ProviderIcon />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] text-foreground">{t("Off")}</span>
            <span className="block truncate text-[11.5px] text-foreground-secondary">
              {t(TOOL_COPY[tool].off)}
            </span>
          </span>
        </div>
        <div className="border-t border-black/[0.065] px-2 py-3 dark:border-white/[0.07]">
          <label className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-foreground">
            <span>
              <span className="block text-[12.5px]">{t("Usage strategy")}</span>
              <span className="block text-[11.5px] text-foreground-secondary">
                {strategy === "round_robin"
                  ? t("Rotate providers across requests.")
                  : t("Try the next provider when one fails.")}
              </span>
            </span>
            <select
              aria-label={t("Usage strategy")}
              className="rounded-md border border-black/[0.12] bg-transparent px-2 py-1.5 text-[12px] dark:border-white/[0.14]"
              disabled={!view || Boolean(busy)}
              onChange={(event) => setStrategy(event.target.value as WebToolStrategy)}
              value={strategy}
            >
              <option value="failover">{t("Failover")}</option>
              <option value="round_robin">{t("Round-robin")}</option>
            </select>
          </label>
        </div>
        {orderedProviders.map(renderProvider)}
      </SettingsGroup>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 px-2">
        <div className="text-[12px] text-foreground-secondary">
          {t("Keys are stored on your server and never shown again.")}
        </div>
        <button
          className={actionButton}
          disabled={!changed || Boolean(busy)}
          onClick={() => void save()}
          type="button"
        >
          {busy === "save" ? (
            <LoadingOrb aria-hidden size={14} />
          ) : applied ? (
            <Check className="size-3.5" />
          ) : null}
          {applied ? t("Saved") : t("Save")}
        </button>
      </div>
      {errorAlert}
    </section>
  );
}
