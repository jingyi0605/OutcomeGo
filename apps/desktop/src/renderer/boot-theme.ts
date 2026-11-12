import { normalizeThemePreference, resolveTheme } from "@outcomego/design-tokens/appearance";

const preference = (() => {
  try {
    return normalizeThemePreference(localStorage.getItem("outcomego:theme"));
  } catch {
    return "system";
  }
})();
const resolved = resolveTheme(
  preference,
  window.matchMedia("(prefers-color-scheme: dark)").matches
);
document.documentElement.dataset.theme = resolved;
document.documentElement.dataset.themePreference = preference;
document.documentElement.style.colorScheme = resolved;

// The reload into setup marks itself with #outcomego-setup-frame (first-run-shell.tsx); the
// boot screen has already used it, so a later reload starts plain again.
if (window.location.hash === "#outcomego-setup-frame") {
  history.replaceState(history.state, "", window.location.pathname + window.location.search);
}
