import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inherit?: boolean;
  input?: string;
  inputFile?: string;
  outputFile?: string;
  timeoutMs?: number;
  killSignal?: NodeJS.Signals;
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: RunOptions): RunResult;
}

export class SystemCommandRunner implements CommandRunner {
  run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
    const output = options.outputFile ? openSync(options.outputFile, "w", 0o600) : null;
    const input = options.inputFile ? openSync(options.inputFile, "r") : null;
    try {
      const result = spawnSync(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        encoding: "utf8",
        shell: false,
        windowsHide: !options.inherit,
        timeout: options.timeoutMs,
        killSignal: options.killSignal,
        input: options.input,
        stdio: options.inherit
          ? [input ?? (options.input === undefined ? "inherit" : "pipe"), "inherit", "inherit"]
          : options.outputFile
            ? [input ?? (options.input === undefined ? "ignore" : "pipe"), output as number, "pipe"]
            : input
              ? [input, "pipe", "pipe"]
              : "pipe",
      });
      return {
        // A child that Ctrl-C killed outright reports it the way a shell does.
        status: result.status ?? (result.signal === "SIGINT" ? 130 : 1),
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        error: result.error,
      };
    } finally {
      if (output !== null) closeSync(output);
      if (input !== null) closeSync(input);
    }
  }
}

interface StreamingOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

const MAX_STREAM_LINE_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 750;
const childEvents = (child: ReturnType<typeof spawn>) => child as unknown as {
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
};

const lineReader = (onLine: ((line: string) => void) | undefined) => {
  let buffer: Buffer | undefined;
  let length = 0;
  let overflow = false;
  const flush = (newline: boolean) => {
    if (!overflow && (length || newline)) {
      const end = length && buffer?.[length - 1] === 13 ? length - 1 : length;
      onLine?.(buffer?.toString("utf8", 0, end) ?? "");
    }
    length = 0;
    overflow = false;
  };
  return {
    push(chunk: Buffer) {
      if (!onLine) return;
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const size = end - offset;
        if (!overflow) {
          if (length + size > MAX_STREAM_LINE_BYTES) overflow = true;
          else if (size) {
            buffer ??= Buffer.allocUnsafe(MAX_STREAM_LINE_BYTES);
            chunk.copy(buffer, length, offset, end);
            length += size;
          }
        }
        if (newline < 0) break;
        flush(true);
        offset = newline + 1;
      }
    },
    finish: () => flush(false),
  };
};

export const runStreaming = (
  command: string,
  args: readonly string[],
  { cwd, env, input, signal, onStdoutLine, onStderrLine }: StreamingOptions = {}
): Promise<{ status: number; error?: Error }> => {
  if (signal?.aborted) return Promise.resolve({ status: 130 });
  return new Promise((resolve) => {
    const posix = process.platform !== "win32";
    const child = spawn(command, [...args], {
      cwd, env, stdio: "pipe", shell: false, detached: posix, windowsHide: true,
    });
    const stdout = lineReader(onStdoutLine);
    const stderr = lineReader(onStderrLine);
    let error: Error | undefined;
    let aborted = false;
    let closed = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    let terminating = false;
    const signalGroup = (signal: "SIGTERM" | "SIGKILL") => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { return; }
    };
    const terminate = () => {
      if (terminating || !child.pid) return;
      terminating = true;
      if (posix) {
        signalGroup("SIGTERM");
        force = setTimeout(() => signalGroup("SIGKILL"), TERMINATION_GRACE_MS);
      } else {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore", windowsHide: true,
        });
        const fallback = () => { if (!closed) child.kill(); };
        childEvents(killer).once("error", fallback);
        childEvents(killer).once("close", (code) => { if (code !== 0) fallback(); });
      }
    };
    const abort = () => { aborted = true; terminate(); };
    const consume = (callback: () => void) => {
      if (error || aborted) return;
      try { callback(); } catch (cause) {
        error = cause instanceof Error ? cause : new Error(String(cause));
        terminate();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => consume(() => stdout.push(chunk)));
    child.stderr.on("data", (chunk: Buffer) => consume(() => stderr.push(chunk)));
    childEvents(child).once("error", (cause) => { error ??= cause; });
    childEvents(child).once("close", (code, childSignal) => {
      closed = true;
      signal?.removeEventListener("abort", abort);
      if (force) {
        clearTimeout(force);
        signalGroup("SIGKILL");
      }
      consume(stdout.finish);
      consume(stderr.finish);
      resolve({ status: aborted || childSignal === "SIGINT" ? 130 : error ? 1 : (code ?? 1), ...(error ? { error } : {}) });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdin.once("error", () => undefined);
    child.stdin.end(input);
    input = undefined;
  });
};
