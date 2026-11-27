import { api } from "../../../client/outcomego-api";
import { useFeatureSettings } from "../../../hooks/use-feature-settings";
import { GoalsSettingsView } from "./goals-view";

/** The goal-management settings page: the view, bound to the live settings. */
export default function GoalsSettings() {
  return <GoalsSettingsView features={useFeatureSettings()} autoAcceptRules={api.outcomes?.autoAcceptRules} />;
}
