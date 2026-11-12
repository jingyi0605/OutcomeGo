import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const contracts = await Bun.file(resolve(root, "packages/contracts/src/index.ts")).text();
const prisma = await Bun.file(resolve(root, "packages/db/prisma/schema.prisma")).text();
const names = [
  "outcomego_bot_status",
  "onboardingStatus",
  "outcomego_conversation_continuity",
  "outcomego_message_role",
  "outcomego_channel_kind",
  "outcomego_channel_message_sender",
  "outcomego_run_origin",
  "outcomego_run_status",
  "outcomego_push_device_platform",
  "outcomego_run_item_kind",
  "outcomego_todo_status",
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
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0] as string);
};

for (const name of names) {
  const contract = contractValues(name);
  const persisted = prismaValues(name);
  if (JSON.stringify(contract) !== JSON.stringify(persisted)) {
    throw new Error(
      `${name} drifted: contracts=${contract.join(",")} prisma=${persisted.join(",")}`
    );
  }
}
console.log("Contract and persistence enums are aligned");
