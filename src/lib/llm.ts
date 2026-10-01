/**
 * Which AI drives audits, scores journeys and judges pairs.
 *
 * - claude-cli: the `claude` CLI (Claude Code) on a subscription login, called as a subprocess.
 * - codex-cli: the `codex` CLI (OpenAI Codex) on a ChatGPT login, called as a subprocess.
 * - api: the Anthropic API with ANTHROPIC_API_KEY (billed per token).
 * - rules: no AI; the rule-based driver, scores and judge.
 *
 * ARENA_LLMS lists the modes offered, first one is the default, e.g. "claude-cli,codex-cli".
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { z } from "zod";
import { MODELS, createStructured } from "./claude";

import { LLM_MODES, type LlmMode } from "./llmLabels";

export { LLM_LABELS, LLM_MODES, driverLabel, judgeLabel, type LlmMode } from "./llmLabels";

function apiKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ARENA_FORCE_CLAUDE === "1");
}

/** Modes offered to users, default first. Always ends with "rules". */
export function llmModes(): LlmMode[] {
  const listed = (process.env.ARENA_LLMS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is LlmMode => (LLM_MODES as readonly string[]).includes(s));
  const modes = listed.length ? listed : apiKeyPresent() ? (["api"] as LlmMode[]) : [];
  return [...new Set<LlmMode>([...modes, "rules"])];
}

export function defaultLlm(): LlmMode {
  return llmModes()[0];
}

/** Parses a user-supplied mode, falling back to the default when it isn't offered. */
export function pickLlm(value: unknown): LlmMode {
  return llmModes().includes(value as LlmMode) ? (value as LlmMode) : defaultLlm();
}

export function usesAi(mode: LlmMode): boolean {
  return mode !== "rules";
}

// ---------------------------------------------------------------- CLI subprocess

const CLI_TIMEOUT_MS = Number(process.env.ARENA_CLI_TIMEOUT_MS ?? 180_000);

const CLI_MODELS = {
  claude: process.env.ARENA_CLAUDE_CLI_MODEL ?? "sonnet",
  codex: process.env.ARENA_CODEX_CLI_MODEL ?? "",
};

function npmGlobal(...parts: string[]) {
  return path.join(process.env.APPDATA ?? "", "npm", "node_modules", ...parts);
}

// Windows installs these behind .cmd shims, which mangle JSON arguments, so call the real programs.
function claudeCommand(): [string, string[]] {
  if (process.env.ARENA_CLAUDE_BIN) return [process.env.ARENA_CLAUDE_BIN, []];
  if (process.platform === "win32") return [npmGlobal("@anthropic-ai", "claude-code", "bin", "claude.exe"), []];
  return ["claude", []];
}

function codexCommand(): [string, string[]] {
  if (process.env.ARENA_CODEX_BIN) return [process.env.ARENA_CODEX_BIN, []];
  if (process.platform === "win32") return [process.execPath, [npmGlobal("@openai", "codex", "bin", "codex.js")]];
  return ["codex", []];
}

function exec(cmd: string, args: string[], input: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(cmd)} timed out after ${CLI_TIMEOUT_MS / 1000} s`));
    }, CLI_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(cmd)} exited with ${code}: ${(err || out).trim().split("\n").slice(-3).join(" ").slice(0, 400)}`));
    });
    child.stdin.end(input);
  });
}

// Each call runs in an empty folder so the CLI has nothing to read or change.
function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "arena-llm-"));
}

async function claudeCli(system: string, prompt: string, jsonSchema: Record<string, unknown>): Promise<unknown> {
  const [cmd, pre] = claudeCommand();
  const dir = scratchDir();
  try {
    const args = [
      ...pre,
      "-p",
      "--output-format", "json",
      "--json-schema", JSON.stringify(jsonSchema),
      "--system-prompt", system,
      "--tools", "",
      "--no-session-persistence",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--model", CLI_MODELS.claude,
    ];
    const res = JSON.parse(await exec(cmd, args, prompt, dir)) as { is_error?: boolean; result?: string; structured_output?: unknown };
    if (res.is_error) throw new Error(`claude CLI: ${res.result ?? "error"}`);
    if (res.structured_output === undefined) throw new Error("claude CLI returned no structured output.");
    return res.structured_output;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function codexCli(system: string, prompt: string, jsonSchema: Record<string, unknown>): Promise<unknown> {
  const [cmd, pre] = codexCommand();
  const dir = scratchDir();
  try {
    const schemaFile = path.join(dir, "schema.json");
    const outFile = path.join(dir, "out.json");
    fs.writeFileSync(schemaFile, JSON.stringify(jsonSchema));
    const args = [...pre, "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--output-schema", schemaFile, "-o", outFile];
    if (CLI_MODELS.codex) args.push("-m", CLI_MODELS.codex);
    args.push("-");
    const input = `${system}\n\nAnswer directly with the JSON. Do not run any commands or open any files.\n\n${prompt}`;
    await exec(cmd, args, input, dir);
    return JSON.parse(fs.readFileSync(outFile, "utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One structured call through the chosen mode. CLI calls cost nothing per token
 * (they draw on the subscription's usage limits), so they report a cost of 0.
 */
export async function structured<T>(
  mode: LlmMode,
  opts: { role: keyof typeof MODELS; system: string; prompt: string; maxTokens: number; effort?: "low" | "medium" | "high" },
  schema: z.ZodType<T>,
  jsonSchema: Record<string, unknown>,
): Promise<{ data: T; cost: number }> {
  if (mode === "api") {
    return createStructured(
      { model: MODELS[opts.role], max_tokens: opts.maxTokens, effort: opts.effort, system: opts.system, messages: [{ role: "user", content: opts.prompt }] },
      schema,
      jsonSchema,
    );
  }
  if (mode === "claude-cli") return { data: schema.parse(await claudeCli(opts.system, opts.prompt, jsonSchema)), cost: 0 };
  if (mode === "codex-cli") return { data: schema.parse(await codexCli(opts.system, opts.prompt, jsonSchema)), cost: 0 };
  throw new Error("The rule-based mode has no language model.");
}

/** The `driver` value stored on audits run in this mode (the API agent predates the CLI modes). */
export function driverName(mode: LlmMode): string {
  return mode === "api" ? "claude" : mode;
}
