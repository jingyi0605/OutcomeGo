import type { OutcomeWorkThreadView } from "@outcomego/contracts/outcomes";
import { createContext } from "react";

export type OpenWorkThread = (thread: OutcomeWorkThreadView) => void;
export const WorkThreadNavigation = createContext<OpenWorkThread | null>(null);
export const ChatBranchNavigation = createContext<((channelId: string, messageId: string) => void) | null>(null);
