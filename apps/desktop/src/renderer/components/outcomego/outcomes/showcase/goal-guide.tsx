import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import { Component, lazy, type ReactNode, Suspense, useState } from "react";
import { GOAL_STORIES, goalPosterMemory, type GoalRoleId } from "../../../../lib/goal-showcase";
import { goalShowcaseTranslations } from "../../../../lib/goal-showcase-catalog";
import { goalRoleTranslations } from "../../../../lib/goal-showcase-roles-catalog";
import { useI18n } from "../../../../lib/i18n";
import { registerTranslations } from "../../../../lib/i18n-catalog";
import "./goal-showcase.css";

registerTranslations("zh-CN", goalShowcaseTranslations);
registerTranslations("zh-CN", goalRoleTranslations);

const GoalShowcase = lazy(() => import("./goal-showcase"));

/** Whether the owner folded the guide away on this computer. */
export const GOAL_GUIDE_COLLAPSED_KEY = "openteam:goal-guide-collapsed";
/** The role the owner picked on this computer. */
export const GOAL_GUIDE_ROLE_KEY = "openteam:goal-guide-role";

const readStored = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts while the page is open.
  }
};

const readRole = (): GoalRoleId => {
  const stored = readStored(GOAL_GUIDE_ROLE_KEY);
  return GOAL_STORIES.find((story) => story.id === stored)?.id ?? "general";
};

/** The posters are an introduction: if they fail to load or draw, the page below them goes on. */
class GuideBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The introduction at the top of the goal management entry page: open until the owner folds it away. */
export function GoalGuide() {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(() => readStored(GOAL_GUIDE_COLLAPSED_KEY) === "true");
  const [role, setRole] = useState(readRole);
  const toggle = () => {
    setCollapsed(!collapsed);
    store(GOAL_GUIDE_COLLAPSED_KEY, String(!collapsed));
  };
  const pick = (next: GoalRoleId) => {
    if (next === role) return;
    // A role just picked is read from its first page.
    goalPosterMemory.index = 0;
    setRole(next);
    store(GOAL_GUIDE_ROLE_KEY, next);
  };
  const Chevron = collapsed ? ChevronDown : ChevronUp;
  return (
    <section aria-label={t("How goals work")} className="goal-guide">
      <div className="goal-guide-bar">
        <h2>
          <BookOpen aria-hidden="true" className="size-3.5" strokeWidth={1.7} />
          {t("How goals work")}
        </h2>
        <button aria-expanded={!collapsed} onClick={toggle} type="button">
          {t(collapsed ? "Show guide" : "Hide guide")}
          <Chevron aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      {!collapsed && (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: A row of toggle buttons; a fieldset can't lay out its legend in line. */}
          <div aria-label={t("If you are")} className="goal-guide-roles" role="group">
            <span aria-hidden="true">{t("If you are")}</span>
            {GOAL_STORIES.map(({ id, name }) => (
              <button aria-pressed={id === role} data-role-id={id} key={id} onClick={() => pick(id)} type="button">
                {t(name)}
              </button>
            ))}
          </div>
          <GuideBoundary>
            <div className="goal-guide-stage">
              <Suspense fallback={null}>
                <GoalShowcase role={role} />
              </Suspense>
            </div>
          </GuideBoundary>
        </>
      )}
    </section>
  );
}
