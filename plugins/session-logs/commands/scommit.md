---
allowed-tools: Bash(npx tsx:*), Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git diff:*), Bash(git log:*), Bash(mkdir:*), Bash(sed:*)
description: Generate a session log and commit with it
---

## Context

- Current git status: !`git status`
- Staged and unstaged changes: !`git diff HEAD --stat`
- Recent commits: !`git log --oneline -5`

## Your task

You are creating a git commit that includes a session log file capturing this Claude Code session.

### Step 1: Generate the session log

Run the session log generator script:

```
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/generate-session-log.ts
```

This will create a `.sessions/<timestamp>.md` file and print its path to stdout. Capture the output path.

### Step 1b: Write a summary into the session log

The generated file has a placeholder `(auto-generated session log)` after the `## Summary` heading. Replace it with a 1-2 sentence summary of what was accomplished in this session (based on the code changes and conversation context). Use `sed` to do the replacement:

```
sed -i '' 's/(auto-generated session log)/Your summary here/' <session-log-path>
```

### Step 2: Stage all changes

Stage both the code changes and the generated session log file:

```
git add <changed files>
git add .sessions/<generated-file>.md
```

Use `git status` to see what needs staging. Stage specific files — do not use `git add -A`.

### Step 3: Create the commit

Analyze the staged changes and create a commit. The commit message format must be:

```
<summary line describing the code changes>

Session: .sessions/<filename>.md

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

Use a HEREDOC to pass the commit message to ensure correct formatting.

### Important

- Do NOT push to remote
- Do NOT use `git add -A` or `git add .`
- Stage specific files by name
- The summary line should describe the CODE changes, not the session log
- You have the capability to call multiple tools in a single response — use parallel calls where possible
