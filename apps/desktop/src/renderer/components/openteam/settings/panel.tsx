import {
  BrainCircuit,
  CloudDownload,
  Globe,
  Mic,
  Monitor,
  Server,
  Settings,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  type SettingsAnchor,
  type SettingsView,
  settingsViewForAnchor,
} from "../../../lib/app-deep-links";
import { cn } from "../../../lib/cn";
import { SettingsHeading } from "./ui";
import {
  SettingsLanguageProvider,
  settingsText,
  useSettingsLanguage,
} from "./language";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../ui/dialog";

const loadGeneralSettings = () => import("./general");
const loadComputerSettings = () => import("./computer");
const loadModelSettings = () => import("./model");
const loadVoiceSettings = () => import("./transcription");
const loadServerSettings = () => import("./server");
const loadProvidersSettings = () => import("./providers");
const loadUpdatesSettings = () => import("./updates");

const GeneralSettings = lazy(loadGeneralSettings);
const ComputerSettings = lazy(loadComputerSettings);
const ModelSettings = lazy(loadModelSettings);
const VoiceSettings = lazy(loadVoiceSettings);
const ServerSettings = lazy(loadServerSettings);
const ProvidersSettings = lazy(loadProvidersSettings);
const UpdatesSettings = lazy(loadUpdatesSettings);

const sectionLoaders: Record<SettingsView, () => Promise<unknown>> = {
  general: loadGeneralSettings,
  computer: loadComputerSettings,
  model: loadModelSettings,
  voice: loadVoiceSettings,
  server: loadServerSettings,
  providers: loadProvidersSettings,
  updates: loadUpdatesSettings,
};

const sectionComponents = {
  general: GeneralSettings,
  computer: ComputerSettings,
  model: ModelSettings,
  voice: VoiceSettings,
  server: ServerSettings,
  providers: ProvidersSettings,
  updates: UpdatesSettings,
};

const navigation: Array<{
  id: SettingsView;
  english: string;
  chinese: string;
  icon: typeof Settings;
  available: boolean;
}> = [
  { id: "general", english: "General", chinese: "通用", icon: Settings, available: true },
  { id: "computer", english: "Computer", chinese: "电脑", icon: Monitor, available: true },
  { id: "model", english: "Model", chinese: "模型", icon: BrainCircuit, available: true },
  { id: "voice", english: "Voice notes", chinese: "语音消息", icon: Mic, available: true },
  { id: "server", english: "Server", chinese: "服务器", icon: Server, available: true },
  { id: "providers", english: "Providers", chinese: "服务提供商", icon: Globe, available: true },
  { id: "updates", english: "Updates", chinese: "更新", icon: CloudDownload, available: true },
];

function SettingsNavigation({
  view,
  onViewChange,
  compact = false,
}: {
  view: SettingsView;
  onViewChange: (view: SettingsView) => void;
  compact?: boolean;
}) {
  const { language } = useSettingsLanguage();
  return (
    <nav
      aria-label={settingsText(language, "Settings sections", "设置分区")}
      className={cn(
        "space-y-0.5",
        compact
          ? "grid grid-cols-2 gap-1 space-y-0"
          : "max-[512px]:grid max-[512px]:grid-cols-2 max-[512px]:gap-1 max-[512px]:space-y-0"
      )}
    >
      {navigation.map((item) => {
        const Icon = item.icon;
        const preload = () => void sectionLoaders[item.id]();
        return (
          <button
            aria-current={view === item.id ? "page" : undefined}
            aria-disabled={!item.available}
            className={cn(
              "flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px] font-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/35",
              compact && "justify-center",
              !compact && "max-[512px]:justify-center",
              view === item.id
                ? "bg-selected"
                : item.available
                  ? "hover:bg-hover"
                  : "cursor-default"
            )}
            key={item.id}
            onClick={() => {
              if (item.available) onViewChange(item.id);
            }}
            onFocus={preload}
            onPointerEnter={preload}
            type="button"
          >
            <Icon className="size-[15px] shrink-0" strokeWidth={1.75} />
            <span className="truncate">{settingsText(language, item.english, item.chinese)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SettingsContent({
  view,
  scrollRef,
}: {
  view: SettingsView;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { language } = useSettingsLanguage();
  const ActiveSection = sectionComponents[view];
  const currentLabel = navigation.find((item) => item.id === view);

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        className="bot-scrollbar h-full overflow-y-auto px-8 pb-10 pt-8 max-[560px]:px-5"
        ref={scrollRef}
      >
        {view === "providers" ? null : (
          <SettingsHeading>
            {settingsText(
              language,
              currentLabel?.english ?? "General",
              currentLabel?.chinese ?? "通用"
            )}
          </SettingsHeading>
        )}
        <Suspense fallback={null}>
          <ActiveSection />
        </Suspense>
      </div>
    </div>
  );
}

export function SettingsPanel({
  onOpenChange,
  open,
  target,
  presentation = "dialog",
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  target?: { anchor: SettingsAnchor; nonce: number } | null;
  presentation?: "dialog" | "page";
}) {
  const [view, setView] = useState<SettingsView>("general");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !target) setView("general");
  }, [open, target]);

  useEffect(() => {
    if (!open || !target) return;
    const nextView = settingsViewForAnchor(target.anchor);
    setView(nextView);
    void sectionLoaders[nextView]();

    let frame = 0;
    let highlightTimer = 0;
    let attempts = 0;
    const revealTarget = () => {
      const row = Array.from(
        scrollRef.current?.querySelectorAll<HTMLElement>("[data-settings-anchor]") ?? []
      ).find((candidate) => candidate.dataset.settingsAnchor?.split(" ").includes(target.anchor));
      if (!row) {
        attempts += 1;
        if (attempts < 120) frame = window.requestAnimationFrame(revealTarget);
        return;
      }
      row.scrollIntoView({ block: "center" });
      row.classList.remove("settings-anchor-target");
      frame = window.requestAnimationFrame(() => row.classList.add("settings-anchor-target"));
      highlightTimer = window.setTimeout(
        () => row.classList.remove("settings-anchor-target"),
        1_800
      );
    };
    frame = window.requestAnimationFrame(revealTarget);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(highlightTimer);
    };
  }, [open, target]);

  return (
    <SettingsLanguageProvider>
      {presentation === "page" ? (
        <SettingsPage
          onOpenChange={onOpenChange}
          onViewChange={(nextView) => {
            setView(nextView);
            scrollRef.current?.scrollTo({ top: 0 });
          }}
          open={open}
          scrollRef={scrollRef}
          view={view}
        />
      ) : (
        <SettingsDialog
          onOpenChange={onOpenChange}
          onViewChange={(nextView) => {
            setView(nextView);
            scrollRef.current?.scrollTo({ top: 0 });
          }}
          open={open}
          scrollRef={scrollRef}
          view={view}
        />
      )}
    </SettingsLanguageProvider>
  );
}

function SettingsPage({
  onOpenChange,
  onViewChange,
  open,
  scrollRef,
  view,
}: {
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: SettingsView) => void;
  open: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  view: SettingsView;
}) {
  const { language } = useSettingsLanguage();
  if (!open) return null;
  return (
    <div
      aria-label={settingsText(language, "Settings", "设置")}
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-background text-foreground"
      role="dialog"
    >
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-black/[0.07] bg-[#f6f6f6] px-4 py-4 dark:border-white/[0.08] dark:bg-[#111111] max-[720px]:w-[200px] max-[560px]:absolute max-[560px]:inset-x-0 max-[560px]:bottom-0 max-[560px]:top-0 max-[560px]:z-10 max-[560px]:hidden">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-[10px] bg-foreground text-[12px] font-semibold text-background">
            O
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold">OpenTeam</div>
            <div className="text-[11px] text-foreground-tertiary">
              {settingsText(language, "Application settings", "应用设置")}
            </div>
          </div>
        </div>
        <SettingsNavigation onViewChange={onViewChange} view={view} />
        <div className="mt-auto px-2 text-[11px] leading-4 text-foreground-tertiary">
          {settingsText(language, "Changes are saved as you make them.", "设置会在修改后自动保存。")}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-black/[0.07] px-8 dark:border-white/[0.08] max-[560px]:px-5">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-foreground-tertiary">
              {settingsText(language, "OpenTeam", "OpenTeam")}
            </p>
            <h1 className="mt-0.5 text-[18px] font-medium tracking-[-0.02em]">
              {settingsText(language, "Settings", "设置")}
            </h1>
          </div>
          <button
            aria-label={settingsText(language, "Close settings", "关闭设置")}
            className="grid size-9 place-items-center rounded-full text-foreground-tertiary transition-colors hover:bg-black/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 dark:hover:bg-white/[0.07]"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            <X className="size-[18px]" strokeWidth={1.7} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[194px] shrink-0 border-r border-black/[0.07] px-3 py-5 dark:border-white/[0.08] max-[560px]:block">
            <SettingsNavigation compact onViewChange={onViewChange} view={view} />
          </div>
          <SettingsContent scrollRef={scrollRef} view={view} />
        </div>
      </main>
    </div>
  );
}

function SettingsDialog({
  onOpenChange,
  onViewChange,
  open,
  scrollRef,
  view,
}: {
  onOpenChange: (open: boolean) => void;
  onViewChange: (view: SettingsView) => void;
  open: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  view: SettingsView;
}) {
  const { language } = useSettingsLanguage();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const trigger = document.querySelector<HTMLElement>("[data-sidebar-account-trigger]");
          if (trigger) {
            event.preventDefault();
            trigger.focus();
          }
        }}
        className="grid h-[min(700px,calc(100vh-96px))] w-[min(900px,calc(100vw-40px))] max-w-none grid-cols-[198px_minmax(0,1fr)] gap-0 overflow-hidden rounded-[15px] border-black/10 bg-[#fcfcfc] p-0 shadow-[0_22px_70px_rgba(0,0,0,0.20)] dark:border-[#303030] dark:bg-[#070707] max-[512px]:grid-cols-1 max-[512px]:grid-rows-[auto_minmax(0,1fr)]"
        showCloseButton={false}
        surface="transparent"
      >
        <DialogTitle className="sr-only">{settingsText(language, "Settings", "设置")}</DialogTitle>
        <DialogDescription className="sr-only">
          {settingsText(language, "Configure OpenTeam and application updates.", "配置 OpenTeam 和应用更新。")}
        </DialogDescription>
        <aside className="border-r-[0.5px] border-black/[0.07] bg-[#f7f7f7] px-3 pb-4 pt-4 dark:border-white/[0.07] dark:bg-[#111111] max-[512px]:border-b-[0.5px] max-[512px]:border-r-0 max-[512px]:py-2">
          <SettingsNavigation compact={false} onViewChange={onViewChange} view={view} />
        </aside>
        <section className="relative min-h-0 min-w-0">
          <DialogClose asChild>
            <button
              aria-label={settingsText(language, "Close", "关闭")}
              className="absolute right-2.5 top-2.5 z-10 grid size-8 place-items-center rounded-full text-foreground-tertiary outline-none transition-colors hover:bg-black/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35 dark:hover:bg-white/[0.06]"
              type="button"
            >
              <X className="size-4" strokeWidth={1.7} />
            </button>
          </DialogClose>
          <SettingsContent scrollRef={scrollRef} view={view} />
        </section>
      </DialogContent>
    </Dialog>
  );
}
