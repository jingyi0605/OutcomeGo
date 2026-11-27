// The goal posters retold for particular roles (goal-showcase.ts). Each example stays within what a
// bot does today: research, documents, spreadsheets and code. Paying, sending and publishing are
// shown as the owner's own steps.
import type { GoalStory } from "./goal-showcase";

export const ROLE_STORIES: readonly GoalStory[] = [
  {
    id: "sales",
    concept: {
      title: "Chase the deal, not the paperwork",
      body: "Hand over research, quotes and bid material. Price and the customer conversation stay yours.",
      points: [
        "Goals: account research, quote options, bid material",
        "To-dos and schedules: call-backs, a briefing before a visit",
        "Notes: what the customer said, ready for the next quote",
      ],
    },
    capture: {
      title: "Back from a visit? Jot it down",
      body: "Write what the customer asked for and drop in their files. It is saved at once.",
      also: "A call-back reminder or visit notes go in the same way",
    },
    approve: {
      title: "Check the terms, then say go",
      body: "The bot drafts the plan and criteria first. Approve once the discount terms are spelled out.",
    },
    accept: {
      title: "You set the price and accept",
      body: "Which discount to give, who to call, whether the quote can go out: it all comes to you.",
    },
    picture: {
      bot: { name: "Sales helper", shape: "bulb" },
      line: "Draft the client quote by Friday",
      file: "Requirements.pdf",
      plan: "Quote proposal",
      criteria: ["Three price tiers offered", "Discount terms spelled out", "Past deals cited"],
      asks: ["What discount to give?", "Confirm their budget", "The quote is ready"],
    },
  },
  {
    id: "designer",
    concept: {
      title: "Hand off legwork, keep the taste",
      body: "Reference hunting, spec checks and handoff notes go to a bot. Direction and taste stay yours.",
      points: [
        "Goals: reference research, spec checks, handoff notes",
        "To-dos and schedules: send assets, prepare for a design review",
        "Ideas and notes: sparks and client feedback in one place",
      ],
    },
    capture: {
      title: "Catch the spark before it goes",
      body: "Paste a screenshot or drop in the brand guide, add one line, and it is saved at once.",
      also: "A passing idea or client feedback goes in the same way",
    },
    approve: {
      title: "Agree on the bar first",
      body: "The bot writes the plan and criteria first. Approve once colors, fonts and sizes are covered.",
    },
    accept: {
      title: "You pick the direction",
      body: "Which direction to take, whether images are cleared, whether the work is ready: your call.",
    },
    picture: {
      bot: { name: "Design helper", shape: "owl" },
      line: "Three campaign page directions",
      file: "Brand guide.pdf",
      plan: "Visual directions",
      criteria: ["References with sources", "Brand colors and fonts kept", "When each one fits"],
      asks: ["Which direction?", "Confirm image rights", "Directions are ready"],
    },
  },
  {
    id: "developer",
    concept: {
      title: "Hand off the digging, keep the call",
      body: "A bot investigates, fixes, tests and documents on its own computer. You review before it ships.",
      points: [
        "Goals: bug fixes, upgrade research, missing tests",
        "To-dos and schedules: code reviews, checks before a release",
        "Ideas and notes: refactoring thoughts, debugging records",
      ],
    },
    capture: {
      title: "Paste the error and press Go",
      body: "Paste a screenshot or drop in the log, say what's wrong in a line, and it is saved at once.",
      also: "A refactoring idea or a debugging note goes in the same way",
    },
    approve: {
      title: "Review the approach first",
      body: "The bot says how it will fix it and how you can tell. Approve once scope and tests look right.",
    },
    accept: {
      title: "See the tests, then accept",
      body: "Settings to choose, checks only you can run and the final review are gathered in one place.",
    },
    picture: {
      bot: { name: "Dev helper", shape: "terminal" },
      line: "Fix the sign-in timeout bug",
      file: "error.log",
      plan: "Sign-in timeout fix",
      criteria: ["Cause found and explained", "Regression test added", "All tests pass"],
      asks: ["What timeout to use?", "Try sign-in on staging", "The fix is ready"],
    },
  },
  {
    id: "projects",
    concept: {
      title: "Chase less status, decide more",
      body: "Progress summaries, risk lists and meeting follow-ups go to a bot. Scope and dates are your call.",
      points: [
        "Goals: status reports, risk lists, rollout plans",
        "To-dos and schedules: follow-ups, a digest before a meeting",
        "Calendar: goal and to-do due dates side by side",
      ],
    },
    capture: {
      title: "Meeting over? Capture it",
      body: "Drop in the minutes or the project plan, say what you need, and it is saved at once.",
      also: "One set of minutes can be split into several to-dos",
    },
    approve: {
      title: "Agree on the checklist first",
      body: "The bot writes the plan and criteria first. Approve once owners and dates are covered.",
    },
    accept: {
      title: "Risks surface, you decide",
      body: "A slipping milestone, a date only you can confirm, a finished report: all in one place.",
    },
    picture: {
      bot: { name: "Project helper", shape: "dual-screen" },
      line: "Status and risk report by Thursday",
      file: "Project plan.xlsx",
      plan: "Weekly status report",
      criteria: ["Every milestone has a status", "Delays name cause and owner", "Risks come with options"],
      asks: ["Move the milestone?", "Confirm dates by phone", "Status report is ready"],
    },
  },
  {
    id: "finance",
    concept: {
      title: "It checks, you sign off",
      body: "Reconciling, spotting exceptions and drafting analysis go to a bot. Approving and paying stay yours.",
      points: [
        "Goals: expense checks, reconciliations, budget analysis",
        "To-dos and schedules: filing dates, a summary before closing",
        "Calendar: when filings and payments fall due",
      ],
    },
    capture: {
      title: "Drop in the sheet, say what to check",
      body: "Add the spreadsheet, write what to check and by when, and it is saved at once.",
      also: "Filing and payment reminders go in the same way, with dates",
    },
    approve: {
      title: "Set the rules, then check",
      body: "The bot writes the plan and criteria first. Approve once limits and exceptions are defined right.",
    },
    accept: {
      title: "Every figure traces back",
      body: "Exceptions to rule on, payments to double-check and the finished reconciliation come to you.",
    },
    picture: {
      bot: { name: "Finance helper", shape: "chip" },
      line: "Check this month's expense claims",
      file: "Expenses.xlsx",
      plan: "Expense check",
      criteria: ["Each exception has proof", "Totals match the ledger", "Over-limit items listed"],
      asks: ["Allow the overspend?", "Review the payment", "Check results ready"],
    },
  },
  {
    id: "marketing",
    concept: {
      title: "Shape the campaign, skip the grind",
      body: "Market research, campaign plans and result reviews go to a bot. Budget and publishing are your call.",
      points: [
        "Goals: campaign plans, competitor research, result reviews",
        "To-dos and schedules: publishing reminders, pre-launch checks",
        "Ideas: topics and angles, parked until you pick one up",
      ],
    },
    capture: {
      title: "Park the idea, plan it later",
      body: "One line is enough. Drop in past data or reference screenshots if you have them.",
      also: "An idea can later become a goal and keep its history",
    },
    approve: {
      title: "See the budget split first",
      body: "The bot writes the plan and criteria first. Approve once audience, channels and budget are right.",
    },
    accept: {
      title: "You decide what goes out",
      body: "Where the budget goes, copy to review and the finished plan wait for you in one place.",
    },
    picture: {
      bot: { name: "Marketing helper", shape: "periscope" },
      line: "Plan the holiday sale by Monday",
      file: "Past results.xlsx",
      plan: "Campaign plan",
      criteria: ["Audience and channels set", "Budget split by channel", "Backed by past data"],
      asks: ["Which channel first?", "Approve and post copy", "Campaign plan is ready"],
    },
  },
  {
    id: "hr",
    concept: {
      title: "Sift less, talk to people more",
      body: "Candidate comparisons, onboarding lists and policy drafts go to a bot. Decisions about people stay yours.",
      points: [
        "Goals: candidate comparisons, training plans, policy drafts",
        "To-dos and schedules: interview prep, onboarding follow-ups",
        "Notes: interview impressions, ready for the next round",
      ],
    },
    capture: {
      title: "One line starts the shortlist",
      body: "Drop in the job description, say what to compare, and it is saved at once.",
      also: "Interview notes and follow-ups go in the same way",
    },
    approve: {
      title: "Agree on the yardstick first",
      body: "The bot writes the plan and criteria first. Approve once they judge only what the job requires.",
    },
    accept: {
      title: "Who joins is your decision",
      body: "Who goes through, interviews to arrange and the finished comparison all come to you.",
    },
    picture: {
      bot: { name: "HR helper", shape: "pod" },
      line: "Compare this week's candidates",
      file: "Job spec.pdf",
      plan: "Candidate comparison",
      criteria: ["Matched to each requirement", "Every claim cites the CV", "Open questions listed"],
      asks: ["Who goes to the final?", "Arrange the interview", "Comparison is ready"],
    },
  },
  {
    id: "manager",
    concept: {
      title: "Read the answer, make the call",
      body: "Business briefings, studies and meeting prep go to bots. What needs your decision lines up for you.",
      points: [
        "Goals: business briefings, market studies, meeting packs",
        "To-dos and schedules: follow-ups, a briefing before a meeting",
        "Dashboard: everything waiting for you, in one list",
      ],
    },
    capture: {
      title: "Say it once, it gets filed",
      body: "A thought, a screenshot or a report: add one line and it is sorted in the background.",
      also: "Several matters in one note can be split into separate items",
    },
    approve: {
      title: "Steer before work starts",
      body: "The bot writes the plan and criteria first. Approve once it answers the question you care about.",
    },
    accept: {
      title: "Decide with evidence in hand",
      body: "Decisions to make, people to meet and briefings to review arrive together.",
    },
    picture: {
      bot: { name: "Chief of staff", shape: "tv-head" },
      line: "One-page business brief by Monday",
      file: "Business data.xlsx",
      plan: "Business briefing",
      criteria: ["Key figures cite sources", "Unusual changes explained", "Decisions needed listed"],
      asks: ["Raise the ad budget?", "Meet the partner", "The briefing is ready"],
    },
  },
];
