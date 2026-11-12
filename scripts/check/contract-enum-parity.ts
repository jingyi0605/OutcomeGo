import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const contracts = await Bun.file(resolve(root, "packages/contracts/src/index.ts")).text();
const prisma = await Bun.file(resolve(root, "packages/db/prisma/schema.prisma")).text();
const names = [
  { contract: "BotStatus", prisma: "BotStatus", database: "outcomego_bot_status" },
  { contract: "OnboardingStatus", prisma: "OnboardingStatus", database: "outcomego_onboarding_status" },
  { contract: "ConversationContinuity", prisma: "ConversationContinuity", database: "outcomego_conversation_continuity" },
  { contract: "MessageRole", prisma: "MessageRole", database: "outcomego_message_role" },
  { contract: "ChannelKind", prisma: "ChannelKind", database: "outcomego_channel_kind" },
  { contract: "ChannelMessageSender", prisma: "ChannelMessageSender", database: "outcomego_channel_message_sender" },
  { contract: "RunOrigin", prisma: "RunOrigin", database: "outcomego_run_origin" },
  { contract: "RunStatus", prisma: "RunStatus", database: "outcomego_run_status" },
  { contract: "PushDevicePlatform", prisma: "PushDevicePlatform", database: "outcomego_push_device_platform" },
  { contract: "RunItemKind", prisma: "RunItemKind", database: "outcomego_run_item_kind" },
  { contract: "TodoStatus", prisma: "TodoStatus", database: "outcomego_todo_status" },
] as const;

const contractValues = (name: string): string[] => {
  const match = new RegExp(`export const ${name} = Schema\\.Literal\\(([\\s\\S]*?)\\);`).exec(
    contracts
  );
  if (!match?.[1]) throw new Error(`Missing contract literal ${name}`);
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((value) => value[1] as string);
};

const prismaValues = (name: string): string[] => {
  const match = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`).exec(prisma);
  if (!match?.[1]) throw new Error(`Missing Prisma enum ${name}`);
  return match[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => Boolean(line) && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0] as string);
};

const prismaDatabaseName = (name: string): string | undefined => {
  const match = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`).exec(prisma);
  return match?.[1]?.match(/@@map\("([^"]+)"\)/)?.[1];
};

for (const { contract: contractName, prisma: prismaName, database } of names) {
  const contract = contractValues(contractName);
  const persisted = prismaValues(prismaName);
  if (JSON.stringify(contract) !== JSON.stringify(persisted)) {
    throw new Error(
      `${contractName} drifted: contracts=${contract.join(",")} prisma=${persisted.join(",")}`
    );
  }
  const mapped = prismaDatabaseName(prismaName);
  if (mapped !== database) {
    throw new Error(`${prismaName} database mapping drifted: expected=${database} prisma=${mapped}`);
  }
}
console.log("Contract and persistence enums are aligned");
