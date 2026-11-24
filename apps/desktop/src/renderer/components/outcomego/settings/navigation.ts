import {
  AudioLines,
  BrainCircuit,
  CloudDownload,
  Globe,
  Keyboard,
  Mic,
  Monitor,
  Server,
  Settings,
  Target,
} from "lucide-react";
import type { SettingsView } from "../../../lib/app-deep-links";

/**
 * The settings pages in the order they appear. "Goal management" sits between "Model" and "Voice notes" (specs/004.10);
 * every other page keeps its name and its place. It has no command-palette entry: the palette lists only a few pages
 * and a test pins that list.
 */
export const SETTINGS_NAVIGATION: ReadonlyArray<{ id: SettingsView; label: string; icon: typeof Settings }> = [
  { id: "general", label: "General", icon: Settings },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
  { id: "computer", label: "Computer", icon: Monitor },
  { id: "model", label: "Model", icon: BrainCircuit },
  { id: "goals", label: "Goal management", icon: Target },
  { id: "voice", label: "Voice notes", icon: Mic },
  { id: "realtime-voice", label: "Realtime voice", icon: AudioLines },
  { id: "server", label: "Server", icon: Server },
  { id: "providers", label: "Providers", icon: Globe },
  { id: "updates", label: "Updates", icon: CloudDownload },
];
