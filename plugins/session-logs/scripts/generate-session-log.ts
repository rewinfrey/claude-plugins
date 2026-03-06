#!/usr/bin/env npx tsx
/**
 * generate-session-log.ts
 *
 * Reads the Claude Code JSONL transcript for the current session,
 * filters entries since the last git commit, and writes a structured
 * Markdown session log to .sessions/<timestamp>.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname } from "path";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const sessionId = process.env.CLAUDE_SESSION_ID;
const transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH;

if (!sessionId || !transcriptPath) {
  console.error(
    "Missing CLAUDE_SESSION_ID or CLAUDE_TRANSCRIPT_PATH env vars.\n" +
      "This script should be run inside a Claude Code session with the session-logs plugin."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Last commit timestamp (used to scope messages)
// ---------------------------------------------------------------------------

let lastCommitISO: string | null = null;
try {
  lastCommitISO = execFileSync("git", ["log", "-1", "--format=%aI"], { encoding: "utf-8" }).trim();
} catch {
  // No commits yet — include everything
}

const lastCommitDate = lastCommitISO ? new Date(lastCommitISO) : null;

// ---------------------------------------------------------------------------
// Parse JSONL
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
}

interface TranscriptEntry {
  type: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: string | ContentBlock[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  version?: string;
}

// After context compaction, Claude Code creates a new internal conversation
// with a new ID and writes to a new JSONL file. CLAUDE_TRANSCRIPT_PATH and
// CLAUDE_SESSION_ID still reflect the original values. To capture the full
// session, we need to:
// 1. Find all JSONL files that contain our session ID
// 2. Collect all conversation IDs from those files (the continuation IDs)
// 3. Gather entries from any of those IDs across all files
const projectDir = dirname(transcriptPath);
const jsonlFiles = readdirSync(projectDir)
  .filter((f) => f.endsWith(".jsonl"))
  .map((f) => join(projectDir, f));

// First pass: find all conversation IDs that share a file with our session ID
const allSessionIds = new Set<string>([sessionId]);
for (const filePath of jsonlFiles) {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  let fileHasOurSession = false;
  const fileSessionIds = new Set<string>();
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const sid = obj.sessionId;
      if (!sid) continue;
      if (sid === sessionId) fileHasOurSession = true;
      fileSessionIds.add(sid);
    } catch {
      // skip malformed lines
    }
  }
  // If this file contains our session, all IDs in it are continuations
  if (fileHasOurSession) {
    for (const sid of fileSessionIds) {
      allSessionIds.add(sid);
    }
  }
}

// Second pass: collect entries from all related session IDs
const entries: TranscriptEntry[] = [];
for (const filePath of jsonlFiles) {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const obj: TranscriptEntry = JSON.parse(line);
      if (!obj.sessionId || !allSessionIds.has(obj.sessionId)) continue;
      if (!obj.timestamp) continue;
      if (lastCommitDate && new Date(obj.timestamp) <= lastCommitDate) continue;
      entries.push(obj);
    } catch {
      // skip malformed lines
    }
  }
}

// Sort by timestamp to ensure correct ordering across files
entries.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());

if (entries.length === 0) {
  console.error("No transcript entries found for this session since last commit.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Aggregate stats
// ---------------------------------------------------------------------------

let inputTokens = 0;
let outputTokens = 0;
let cacheRead = 0;
let cacheCreation = 0;
let toolCallCount = 0;
let model = "unknown";
let cliVersion = "unknown";

for (const entry of entries) {
  if (entry.version && cliVersion === "unknown") cliVersion = entry.version;

  if (entry.type === "assistant" && entry.message) {
    const msg = entry.message;
    if (msg.model) model = msg.model;

    const usage = msg.usage;
    if (usage) {
      inputTokens += usage.input_tokens ?? 0;
      outputTokens += usage.output_tokens ?? 0;
      cacheRead += usage.cache_read_input_tokens ?? 0;
      cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }

    // Count tool calls
    const content = msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") toolCallCount++;
      }
    }
  }
}

// Duration from first to last entry
const firstTs = new Date(entries[0].timestamp!);
const lastTs = new Date(entries[entries.length - 1].timestamp!);
const durationMinutes = Math.round((lastTs.getTime() - firstTs.getTime()) / 60000);

// ---------------------------------------------------------------------------
// Build Markdown conversation
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n… (truncated)";
}

function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join("\n\n");
}

function extractToolResultText(content: string | Array<{ type: string; text?: string }> | undefined): string {
  if (!content) return "(no output)";
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

const conversationParts: string[] = [];

for (const entry of entries) {
  if (entry.type === "user" && entry.message) {
    const content = entry.message.content;

    // User text messages
    const text = extractText(content);

    // Stop capturing once the scommit command is invoked — everything
    // after this point is commit mechanics, not session content
    if (text && text.includes("<command-name>/session-logs:scommit</command-name>")) {
      break;
    }

    if (text && !text.startsWith("[Request interrupted")) {
      conversationParts.push(`### User\n\n${truncate(text, 2000)}`);
    }

    // Tool results
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_result") {
          const resultText = extractToolResultText(block.content);
          conversationParts.push(
            `### Tool Result\n\n\`\`\`\n${truncate(resultText, 500)}\n\`\`\``
          );
        }
      }
    }
  }

  if (entry.type === "assistant" && entry.message) {
    const content = entry.message.content;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "text" && block.text) {
          conversationParts.push(`### Assistant\n\n${truncate(block.text, 2000)}`);
        }
        if (block.type === "tool_use") {
          const inputSummary = block.input
            ? Object.entries(block.input)
                .map(([k, v]) => {
                  const val = typeof v === "string" ? truncate(v, 200) : JSON.stringify(v)?.slice(0, 200);
                  return `${k}: ${val}`;
                })
                .join("\n")
            : "";
          conversationParts.push(
            `### Tool Use: ${block.name}\n\n\`\`\`\n${truncate(inputSummary, 500)}\n\`\`\``
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Git context for frontmatter
// ---------------------------------------------------------------------------

let filesChanged: string[] = [];
try {
  const diff = execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf-8" }).trim();
  const unstaged = execFileSync("git", ["diff", "--name-only"], { encoding: "utf-8" }).trim();
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf-8" }).trim();
  filesChanged = [...new Set([...diff.split("\n"), ...unstaged.split("\n"), ...untracked.split("\n")].filter(Boolean))];
} catch {
  // not in a git repo
}

// ---------------------------------------------------------------------------
// Write session log
// ---------------------------------------------------------------------------

const now = new Date();
const timestamp = now.toISOString();
const filename = timestamp.replace(/[:.]/g, "-");

const sessionsDir = join(process.cwd(), ".sessions");
if (!existsSync(sessionsDir)) {
  mkdirSync(sessionsDir, { recursive: true });
}

const outputPath = join(sessionsDir, `${filename}.md`);

const frontmatter = [
  "---",
  `session_id: "${sessionId}"`,
  `timestamp: "${timestamp}"`,
  `model: "${model}"`,
  `harness: "claude-code"`,
  `harness_version: "${cliVersion}"`,
  `tokens:`,
  `  input: ${inputTokens}`,
  `  output: ${outputTokens}`,
  `  cache_read: ${cacheRead}`,
  `  cache_creation: ${cacheCreation}`,
  `tool_calls: ${toolCallCount}`,
  `duration_minutes: ${durationMinutes}`,
  `files_changed:`,
  ...filesChanged.map((f) => `  - "${f}"`),
  "---",
].join("\n");

const body = `## Summary\n\n(auto-generated session log)\n\n## Conversation\n\n${conversationParts.join("\n\n")}`;

writeFileSync(outputPath, `${frontmatter}\n\n${body}\n`);

// Print filename to stdout so the /scommit command can pick it up
console.log(outputPath);
