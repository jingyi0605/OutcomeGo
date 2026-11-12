import { normalizeBaseUrl, withDefaultScheme } from "@outcomego/client-core/http";
import { translateCurrent } from "./i18n-catalog";

const EXAMPLE = "192.168.1.20:8787";

/**
 * Why a typed server address can't be used, in the sign-in screen's terms: people paste
 * what their terminal printed, without http://. Null when the address is worth trying.
 */
export function serverAddressProblem(value: string): string | null {
  const address = value.trim();
  if (!address)
    return translateCurrent("Enter your server's address, like {example}.", { example: EXAMPLE });
  if (/\s/.test(address)) {
    return translateCurrent(
      "A server address has no spaces. Use the one your terminal printed, like {example}.",
      { example: EXAMPLE }
    );
  }
  try {
    normalizeBaseUrl(withDefaultScheme(address));
    return null;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/username or password/.test(message)) {
      return translateCurrent(
        "Leave the username and password out of the address. You'll sign in on the next screen."
      );
    }
    if (/query or fragment/.test(message)) {
      return translateCurrent("Use the server address without anything after ? or #.");
    }
    return translateCurrent(
      "That doesn't look like a server address. Use the one your terminal printed, like {example}.",
      { example: EXAMPLE }
    );
  }
}

/** A host short enough for a small label: "raghav-agent-testing…:8788". */
export function shortHost(host: string): string {
  if (host.length <= 22) return host;
  const [name = "", port] = host.split(":");
  const first = name.split(".")[0] ?? name;
  const head = first.length > 20 ? first.slice(0, 19) : first;
  return `${head}…${port ? `:${port}` : ""}`;
}
