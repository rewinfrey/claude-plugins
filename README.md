# claude-plugins

A collection of custom plugins for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's official CLI for Claude.

## Plugins

### session-logs

Captures Claude Code session transcripts as structured Markdown logs that are automatically committed alongside code changes. Each log includes conversation history, token usage, tool calls, and associated file changes.

Session logs are stored in a `.sessions/` directory at the root of your project (created automatically if it doesn't exist).

**How it works:**

1. A `SessionStart` hook injects `CLAUDE_SESSION_ID` and `CLAUDE_TRANSCRIPT_PATH` environment variables into the session
2. The `/scommit` slash command generates a session log from the JSONL transcript, then guides you through committing it with your code changes
3. Session logs are saved to `.sessions/<timestamp>.md` with YAML frontmatter containing metadata and token statistics

**Usage:**

```
/scommit
```

This will:
- Parse the current session transcript
- Generate a Markdown log with conversation history and usage stats
- Stage your changes and create a commit that includes the session log

**Session log contents:**
- Session metadata (model, CLI version, duration)
- Token usage (input, output, cache reads/writes)
- Tool call counts
- File changes
- Full conversation with truncated tool outputs

## Installation

This repo is a [Claude Code plugin marketplace](https://code.claude.com/docs/en/discover-plugins). Install plugins in two steps:

### 1. Add the marketplace

```
/plugin marketplace add rewinfrey/claude-plugins
```

### 2. Install a plugin

```
/plugin install session-logs@rewinfrey-plugins
```

After installation, the `/session-logs:scommit` command is immediately available. Run `/reload-plugins` if commands don't appear right away.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- Node.js with `tsx` (for running the TypeScript log generator)
- `jq` (used by the session hook handler)

## License

MIT
