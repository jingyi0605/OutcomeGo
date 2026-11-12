import { clientErrorMessage } from "@outcomego/product-core/redaction";
import { translateCurrent } from "./i18n-catalog";

/**
 * Localized copy for update status text that the server and its host CLI report.
 *
 * The connection to a server may run an older release, and the host CLI writes its progress,
 * refusals, and failures in English inside the update job's state file. The renderer therefore
 * translates the messages this pipeline is known to produce and keeps any other text verbatim:
 * a translated summary is better than hiding the detail the user needs to fix the failure.
 */

const VERSION = String.raw`(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`;

interface MessageRule {
  pattern: RegExp;
  render: (match: RegExpExecArray) => string;
}

const knownMessages: readonly MessageRule[] = [
  // Server-owned status text: it reports the state of the connected host, not a translation.
  {
    pattern: /^Updates this connected server$/,
    render: () => translateCurrent("Updates this connected server"),
  },
  {
    pattern: /^Run outcomego start on the server to enable updates from the app\.$/,
    render: () =>
      translateCurrent("Run outcomego start on the server to enable updates from the app."),
  },
  {
    pattern: /^Waiting for the server updater to reconnect…$/,
    render: () => translateCurrent("Waiting for the server updater to reconnect…"),
  },
  {
    pattern: /^Update requested\. Waiting for the server updater…$/,
    render: () => translateCurrent("Update requested. Waiting for the server updater…"),
  },
  {
    pattern: /^Choose a newer server release\.$/,
    render: () => translateCurrent("Choose a newer server release."),
  },
  {
    pattern: /^Choose a newer stable server release\.$/,
    render: () => translateCurrent("Choose a newer stable server release."),
  },
  {
    pattern: /^A server update is already in progress\.$/,
    render: () => translateCurrent("A server update is already in progress."),
  },
  {
    pattern: /^Only targetVersion is accepted\.$/,
    render: () => translateCurrent("Only targetVersion is accepted."),
  },
  {
    pattern: /^Sign in to update this server\.$/,
    render: () => translateCurrent("Sign in to update this server."),
  },

  // The update agent on the server host.
  {
    pattern: /^Starting the server updater…$/,
    render: () => translateCurrent("Starting the server updater…"),
  },
  {
    pattern: /^The server updater stopped\. Retry the update\.$/,
    render: () => translateCurrent("The server updater stopped. Retry the update."),
  },
  {
    pattern: /^The server requested an invalid update version\.$/,
    render: () => translateCurrent("The server requested an invalid update version."),
  },

  // Milestones the update worker persists in its job state.
  {
    pattern: /^Update accepted; it will continue if this window closes$/,
    render: () => translateCurrent("Update accepted; it will continue if this window closes"),
  },
  {
    pattern: /^Checking the latest OutcomeGo release$/,
    render: () => translateCurrent("Checking the latest OutcomeGo release"),
  },
  {
    pattern: new RegExp(String.raw`^Downloading and verifying OutcomeGo ${VERSION}$`),
    render: (match) =>
      translateCurrent("Downloading and verifying OutcomeGo {version}", { version: match[1] }),
  },
  {
    pattern: new RegExp(String.raw`^Pulling OutcomeGo ${VERSION} container images$`),
    render: (match) =>
      translateCurrent("Pulling OutcomeGo {version} container images", { version: match[1] }),
  },
  {
    pattern: new RegExp(String.raw`^Backing up the OutcomeGo database before ${VERSION}$`),
    render: (match) =>
      translateCurrent("Backing up the OutcomeGo database before {version}", { version: match[1] }),
  },
  {
    pattern: /^Restarting the server, worker, and computer$/,
    render: () => translateCurrent("Restarting the server, worker, and computer"),
  },
  {
    pattern: new RegExp(String.raw`^OutcomeGo ${VERSION} passed its readiness checks$`),
    render: (match) =>
      translateCurrent("OutcomeGo {version} passed its readiness checks", { version: match[1] }),
  },
  {
    pattern: new RegExp(String.raw`^Installing OutcomeGo ${VERSION} command-line tools$`),
    render: (match) =>
      translateCurrent("Installing OutcomeGo {version} command-line tools", { version: match[1] }),
  },
  {
    pattern: new RegExp(
      String.raw`^OutcomeGo ${VERSION} and its command-line tools are up to date$`
    ),
    render: (match) =>
      translateCurrent("OutcomeGo {version} and its command-line tools are up to date", {
        version: match[1],
      }),
  },
  {
    pattern: new RegExp(String.raw`^OutcomeGo ${VERSION} is already installed$`),
    render: (match) =>
      translateCurrent("OutcomeGo {version} is already installed", { version: match[1] }),
  },
  {
    pattern: new RegExp(
      String.raw`^OutcomeGo and its command-line tools are now running ${VERSION}\.$`
    ),
    render: (match) =>
      translateCurrent("OutcomeGo and its command-line tools are now running {version}.", {
        version: match[1],
      }),
  },
  {
    pattern: new RegExp(String.raw`^OutcomeGo is now running ${VERSION}\.$`),
    render: (match) =>
      translateCurrent("OutcomeGo is now running {version}.", { version: match[1] }),
  },
  {
    pattern: new RegExp(String.raw`^Updating OutcomeGo ${VERSION} → ${VERSION}…$`),
    render: (match) =>
      translateCurrent("Updating OutcomeGo {from} → {to}…", {
        from: match[1],
        to: match[2],
      }),
  },
  {
    pattern: /^The update failed; restoring the previous OutcomeGo configuration$/,
    render: () =>
      translateCurrent("The update failed; restoring the previous OutcomeGo configuration"),
  },

  // Refusals and failures that end up in the job's error state.
  {
    pattern: new RegExp(
      String.raw`^Refusing prerelease ${VERSION} on the stable channel\. Use --allow-prerelease to opt in\.$`
    ),
    render: (match) =>
      translateCurrent(
        "Refusing prerelease {version} on the stable channel. Use --allow-prerelease to opt in.",
        { version: match[1] }
      ),
  },
  {
    pattern: new RegExp(
      String.raw`^Refusing to downgrade OutcomeGo ${VERSION} to ${VERSION}\. Use --allow-downgrade only for an intentional recovery\.$`
    ),
    render: (match) =>
      translateCurrent(
        "Refusing to downgrade OutcomeGo {current} to {target}. Use --allow-downgrade only for an intentional recovery.",
        { current: match[1], target: match[2] }
      ),
  },
  {
    pattern:
      /^Update failed and the previous Compose configuration was restored; the running services were never stopped: ([\s\S]+)$/,
    render: (match) =>
      translateCurrent(
        "Update failed and the previous Compose configuration was restored; the running services were never stopped: {cause}",
        { cause: match[1] }
      ),
  },
  {
    pattern:
      /^Update failed and the previous Compose configuration was restored and restarted: ([\s\S]+)$/,
    render: (match) =>
      translateCurrent(
        "Update failed and the previous Compose configuration was restored and restarted: {cause}",
        { cause: match[1] }
      ),
  },
  {
    pattern:
      /^Update failed and the previous Compose configuration was restored, but it could not be restarted: ([\s\S]+)$/,
    render: (match) =>
      translateCurrent(
        "Update failed and the previous Compose configuration was restored, but it could not be restarted: {cause}",
        { cause: match[1] }
      ),
  },
  // An update refused because bots are still working; the names stay as the user knows them.
  {
    pattern: /^(.+?) is still working\. Nothing changed; try again when it's done\.$/,
    render: (match) =>
      translateCurrent("{names} is still working. Nothing changed; try again when it's done.", {
        names: localizedNameList(splitNames(match[1]!)),
      }),
  },
  {
    pattern: /^(.+?) are still working\. Nothing changed; try again when they're done\.$/,
    render: (match) =>
      translateCurrent("{names} are still working. Nothing changed; try again when they're done.", {
        names: localizedNameList(splitNames(match[1]!)),
      }),
  },
];

const splitNames = (text: string): string[] =>
  text
    .split(/\s*,\s*|\s+and\s+/)
    .map((name) => name.trim())
    .filter(Boolean);

/** Bot names are user data; only the separators follow the interface language. */
const localizedNameList = (names: readonly string[]): string => {
  const known = names.filter((name) => name.trim());
  if (known.length === 0) return translateCurrent("An agent");
  if (known.length === 1) return known[0]!;
  return translateCurrent("{names} and {last}", {
    names: known.slice(0, -1).join(translateCurrent(", ")),
    last: known.at(-1)!,
  });
};

/** "Scout is still working" / "Scout, Orion and Nova are still working", localized. */
export const localizedStillWorking = (names: readonly string[]): string => {
  const list = localizedNameList(names);
  return names.filter((name) => name.trim()).length < 2
    ? translateCurrent("{names} is still working", { names: list })
    : translateCurrent("{names} are still working", { names: list });
};

/** Translates a known server or host-CLI update message; other text stays as reported. */
export const localizeServerUpdateMessage = (message: string | null | undefined): string | null => {
  const text = message?.trim();
  if (!text) return null;
  for (const rule of knownMessages) {
    const match = rule.pattern.exec(text);
    if (match) return rule.render(match);
  }
  return text;
};

/** The failure text of a request that started or failed to start an update. */
export const localizeServerUpdateFailure = (cause: unknown, fallback: string): string => {
  const message = clientErrorMessage(cause, "").trim();
  if (!message) return fallback;
  return localizeServerUpdateMessage(message) ?? fallback;
};

/**
 * Step names are shared English identifiers; each needs its own catalog entry because the plain
 * words ("Restart") already label unrelated interface actions.
 */
export const localizeUpdateStep = (step: string): string => {
  switch (step) {
    case "Prepare":
      return translateCurrent("Prepare update");
    case "Download":
      return translateCurrent("Download update");
    case "Back up":
      return translateCurrent("Back up data");
    case "Restart":
      return translateCurrent("Restart services");
    case "Verify":
      return translateCurrent("Verify update");
    default:
      return translateCurrent(step);
  }
};

// The desktop main process reports its own update states in English as well. Some of that copy
// names a release or a percentage, so match it instead of translating arbitrary text.
const desktopMessages: readonly MessageRule[] = [
  {
    pattern: /^You’re up to date$/,
    render: () => translateCurrent("You’re up to date"),
  },
  {
    pattern: /^No published desktop release is available yet\.$/,
    render: () => translateCurrent("No published desktop release is available yet."),
  },
  {
    pattern: /^Restart OutcomeGo to finish installing the update$/,
    render: () => translateCurrent("Restart OutcomeGo to finish installing the update"),
  },
  {
    pattern: /^Downloading (\d{1,3})%$/,
    render: (match) => translateCurrent("Downloading {percent}%", { percent: match[1] }),
  },
  {
    pattern: new RegExp(
      String.raw`^Desktop ${VERSION} is available\. This copy can’t update itself, so download the new version to replace it\.$`
    ),
    render: (match) =>
      translateCurrent(
        "Desktop {version} is available. This copy can’t update itself, so download the new version to replace it.",
        { version: match[1] }
      ),
  },
  {
    pattern: /^The desktop update service is unavailable$/,
    render: () => translateCurrent("The desktop update service is unavailable"),
  },
  {
    pattern: /^The desktop update service did not return a result$/,
    render: () => translateCurrent("The desktop update service did not return a result"),
  },
  {
    pattern: /^Update service returned (\d{3})$/,
    render: (match) => translateCurrent("Update service returned {status}", { status: match[1] }),
  },
  {
    pattern: /^Update service returned a malformed release manifest$/,
    render: () => translateCurrent("Update service returned a malformed release manifest"),
  },
  {
    pattern: /^Update service returned an invalid release version$/,
    render: () => translateCurrent("Update service returned an invalid release version"),
  },
];

/** Translates the desktop updater's known status text; other text stays as reported. */
export const localizeDesktopUpdateMessage = (message: string | null | undefined): string | null => {
  const text = message?.trim();
  if (!text) return null;
  for (const rule of desktopMessages) {
    const match = rule.pattern.exec(text);
    if (match) return rule.render(match);
  }
  return text;
};
