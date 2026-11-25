import { AUTOMATION_TRIGGER_SHAPE_LINES } from "@outcomego/contracts/reference-main-parsers";
import catalog from "./managed-skills.json";

export default {
  ...catalog,
  version: `${catalog.version}-once`,
  skills: catalog.skills.map((skill) => skill.id !== "routines" ? skill : {
    ...skill,
    content: skill.content
      .replace(/Trigger shapes:\n[\s\S]+?\nPrefer an event-driven trigger/, `Trigger shapes:\n${AUTOMATION_TRIGGER_SHAPE_LINES.join("\n")}\nPrefer an event-driven trigger`)
      .replace("Use cron for genuinely time-based work, unavailable events, or that deadline-enforcement case.",
        "Use a standalone once trigger for a single future time, with optional earlier private preparation. Keep the arrangement for its history after execution. Use cron for recurring time-based work or recurring checks."),
  }),
};
