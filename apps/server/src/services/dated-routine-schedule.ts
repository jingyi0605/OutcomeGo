import { DATED_ROUTINE_CRON } from "@outcomego/contracts";
import { Prisma, type PrismaClient } from "@outcomego/db";

export function listDatedRoutineSchedules(
  db: PrismaClient,
  options: { botId?: string; from?: Date; to?: Date; take?: number },
) {
  return db.$queryRaw<Array<{ id: string; name: string; botId: string; runAt: Date; updatedAt: Date }>>`
    SELECT routine.id, routine.name, routine."botId", routine."nextRunAt" AS "runAt", routine."updatedAt"
    FROM outcomego_routine AS routine
    JOIN outcomego_bot AS bot ON bot.id = routine."botId" AND bot.status = 'active'
    WHERE routine.enabled AND routine."deletedAt" IS NULL AND routine."pausedAt" IS NULL
      AND routine."scheduleKind" = 'cron' AND routine.trigger->>'type' = 'cron'
      AND routine."cronExpression" ~ ${DATED_ROUTINE_CRON.source}
      AND routine."nextRunAt" IS NOT NULL
      ${options.botId ? Prisma.sql`AND routine."botId" = ${options.botId}::uuid` : Prisma.empty}
      ${options.from ? Prisma.sql`AND routine."nextRunAt" >= ${options.from}` : Prisma.empty}
      ${options.to ? Prisma.sql`AND routine."nextRunAt" < ${options.to}` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM outcomego_routine_revision AS revision
        JOIN outcomego_routine_execution AS execution ON execution."routineRevisionId" = revision.id
        WHERE revision."routineId" = routine.id AND revision.revision = routine.revision AND execution.kind = 'scheduled'
      )
    ORDER BY routine."nextRunAt", routine.id
    ${options.take === undefined ? Prisma.empty : Prisma.sql`LIMIT ${options.take}`}`;
}
