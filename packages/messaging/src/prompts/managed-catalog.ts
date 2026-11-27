import { AUTOMATION_TRIGGER_SHAPE_LINES } from "@outcomego/contracts/reference-main-parsers";
import catalog from "./managed-skills.json";

export default {
  ...catalog,
  version: `${catalog.version}-scheduled-outcome`,
  skills: catalog.skills.map((skill) => skill.id !== "routines" ? skill : {
    ...skill,
    content: skill.content
      .replace(/Trigger shapes:\n[\s\S]+?\nPrefer an event-driven trigger/, `Trigger shapes:\n${AUTOMATION_TRIGGER_SHAPE_LINES.join("\n")}\nPrefer an event-driven trigger`)
      .replace("Use cron for genuinely time-based work, unavailable events, or that deadline-enforcement case.",
        "A single future time is not a routine: when CreateOutcome is available, save it as kind=scheduled_once, with optional earlier private preparation through prepareAt; otherwise say it cannot be scheduled from this turn. Use cron for recurring time-based work or recurring checks."),
  }),
};
