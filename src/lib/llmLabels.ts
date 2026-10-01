/** AI mode names and display labels; safe to import from client components. */
export const LLM_MODES = ["claude-cli", "codex-cli", "api", "rules"] as const;
export type LlmMode = (typeof LLM_MODES)[number];

export const LLM_LABELS: Record<LlmMode, { short: string; long: string }> = {
  "claude-cli": { short: "Claude", long: "Claude (via the Claude Code CLI)" },
  "codex-cli": { short: "OpenAI", long: "OpenAI (via the Codex CLI)" },
  api: { short: "Claude API", long: "Claude (via the Anthropic API)" },
  rules: { short: "Rules", long: "the rule-based driver (no AI)" },
};


export function driverLabel(driver: string | null): string {
  if (driver === "claude") return "the Claude browser agent (API)";
  if (driver === "claude-cli") return "the Claude browser agent (Claude Code CLI)";
  if (driver === "codex-cli") return "the OpenAI browser agent (Codex CLI)";
  return "the rule-based driver";
}

export function judgeLabel(judge: string): string {
  if (judge === "rules") return "the rule-based judge (scores only)";
  if ((LLM_MODES as readonly string[]).includes(judge)) return LLM_LABELS[judge as LlmMode].long;
  return judge;
}
