# Issue Agent Slash Command — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/fix-issue <N>` Claude Code slash command that triages a GitHub issue, fixes the underlying bug, and moves it through the GitHub Project board — all using built-in Claude Code tools and the `gh` CLI.

**Architecture:** A single Markdown file at `.claude/commands/fix-issue.md`. When invoked with `/fix-issue <N>`, Claude Code substitutes `$ARGUMENTS` with the issue number and executes the workflow prompt directly using its built-in tools (`Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep`) and the authenticated `gh` CLI.

**Tech Stack:** Claude Code slash commands; `gh` CLI (already authenticated); `git`; Jest (`npm test`)

---

## Hardcoded Project Board IDs

These are verified against the live `darkharasho/axiforge` board and must be used as-is in the command file.

| Field | Value |
|---|---|
| Project number | `1` |
| Project ID | `PVT_kwHOCJlSRs4BRf9t` |
| Status field ID | `PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg` |
| "To triage" option ID | `f971fb55` |
| "Up next" option ID | `4ceeb31c` |
| "In progress" option ID | `5ef0dc97` |
| "Done" option ID | `98236657` |

---

## File Structure

| File | Change |
|---|---|
| `.claude/commands/fix-issue.md` | **Create** — the slash command prompt |

No other files are added or modified.

---

## Chunk 1: Create the slash command

### Task 1: Write `.claude/commands/fix-issue.md`

**Files:**
- Create: `.claude/commands/fix-issue.md`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p .claude/commands
```

Then create `.claude/commands/fix-issue.md` with the exact content below.

> ⚠️ The file contains literal `$ARGUMENTS` — do not expand or escape it. Claude Code substitutes it at runtime.

````markdown
You are a bug-fixing agent for the axiforge GW2 build editor Electron desktop app (repo: `darkharasho/axiforge`).

Your task: fix GitHub issue **#$ARGUMENTS**.

## Codebase Map

- `src/main/` — Electron main process; `src/main/gw2Data.js` fetches GW2 API data
- `src/renderer/renderer.js` — all UI logic (equipment, skills, traits, dropdowns)
- `src/renderer/styles.css` — all styles
- `tests/` — Jest test suite
- Run tests: `npm test`

## GitHub Project Board IDs

| Field | Value |
|---|---|
| Project ID | `PVT_kwHOCJlSRs4BRf9t` |
| Status field ID | `PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg` |
| "In progress" option ID | `5ef0dc97` |
| "Done" option ID | `98236657` |

## Steps

Follow these steps in order. Do not skip steps.

### Step 1 — Fetch issue + compute slug

```bash
gh api repos/darkharasho/axiforge/issues/$ARGUMENTS
```

- If the issue is not found: stop and report the error.
- If `gh` is not authenticated: stop with "Run `gh auth login` first."
- Compute a **slug** from the issue title: first 4–5 words, lowercase, hyphenated.
  Example: "Cant select any stats on equipment" → `cant-select-any-stats`
  Reuse this slug unchanged in Steps 4 and 6.

### Step 2 — Auto-label

Analyze the issue title and body. Choose exactly one label: `bug`, `enhancement`, or `question`.

```bash
gh issue edit $ARGUMENTS --repo darkharasho/axiforge --add-label <label>
```

If the label is **not** `bug`: stop with "Issue is not a bug — aborting fix agent."

### Step 3 — Add to Project board + move to "In progress"

**3a. Add issue to project (idempotent — safe to run if already added):**

```bash
gh project item-add 1 --owner darkharasho \
  --url https://github.com/darkharasho/axiforge/issues/$ARGUMENTS \
  --format json
```

Capture the `id` field from the JSON response. This is the **item ID** used in 3b and Step 11.

**3b. Move to "In progress":**

```bash
gh project item-edit \
  --project-id PVT_kwHOCJlSRs4BRf9t \
  --id <item-id-from-3a> \
  --field-id PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg \
  --single-select-option-id 5ef0dc97
```

### Step 4 — Post opening comment

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge --body "🤖 **Issue agent investigating.**
Hypothesis: <one-line root cause guess>.
Branch: \`fix/issue-$ARGUMENTS-<slug>\`. Will post results when complete."
```

### Step 5 — Explore codebase

Use `Glob`, `Grep`, and `Read` to identify the root cause.
- For UI bugs: start with `src/renderer/renderer.js`
- For data/API bugs: start with `src/main/gw2Data.js`

### Step 6 — Create or reuse branch

Check whether the fix branch already exists remotely:

```bash
git ls-remote --heads origin fix/issue-$ARGUMENTS-<slug>
```

- If it exists: `git checkout fix/issue-$ARGUMENTS-<slug>`
- If not: `git checkout -b fix/issue-$ARGUMENTS-<slug>`

### Step 7 — Fix the bug

Use `Edit` or `Write` to fix the root cause. Make targeted, minimal changes. Do not refactor unrelated code.

### Step 8 — Run tests (max 2 attempts)

```bash
npm test
```

If tests fail: revise the fix and run once more.
If they still fail after 2 attempts: go to the **Failure Path** below.

### Step 9 — Commit + push

```bash
git add -A
git commit -m "fix: <issue title> (closes #$ARGUMENTS)"
git push -u origin fix/issue-$ARGUMENTS-<slug>
```

### Step 10 — Open PR (or find existing)

Check for an existing PR on this branch:

```bash
gh pr list --repo darkharasho/axiforge \
  --head fix/issue-$ARGUMENTS-<slug> \
  --json url
```

- If a PR exists: capture its URL, skip `gh pr create`.
- If no PR exists:

```bash
gh pr create \
  --repo darkharasho/axiforge \
  --title "fix: <issue title> (closes #$ARGUMENTS)" \
  --body "## Summary
<one paragraph describing root cause and fix>

Closes #$ARGUMENTS" \
  --base main \
  --head fix/issue-$ARGUMENTS-<slug>
```

Capture the PR URL.

### Step 11 — Move to "Done" + close out

**Move to Done:**

```bash
gh project item-edit \
  --project-id PVT_kwHOCJlSRs4BRf9t \
  --id <item-id-from-step-3a> \
  --field-id PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg \
  --single-select-option-id 98236657
```

**Post closing comment:**

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge \
  --body "✅ **Fix complete.** PR: <pr-url>"
```

End your response with: `PR opened: <pr-url>`

---

## Failure Path

If tests still fail after 2 attempts, or you cannot identify the root cause:

1. Do **not** move the issue status (leave it "In progress").
2. Post a comment:

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge \
  --body "🤖 **Could not fix automatically.**
What I tried: <summary of approaches>
Why it failed: <specific reason>"
```

3. End your response with: `Could not fix: <one-line reason>`
````

- [ ] **Step 2: Verify the file exists and looks correct**

```bash
cat .claude/commands/fix-issue.md
```

Expected: full command content displayed with no truncation, `$ARGUMENTS` appearing literally (not substituted).

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/fix-issue.md
git commit -m "feat: add /fix-issue slash command for automated bug fixing"
```

---

## Chunk 2: Smoke test

### Task 2: Verify the command is wired up

- [ ] **Step 1: Confirm the command appears in Claude Code**

In Claude Code (CLI or VS Code), type `/fix` and check that `fix-issue` appears in the autocomplete list.

Expected: `fix-issue` listed as an available slash command.

- [ ] **Step 2: Test invocation with a closed issue**

Run `/fix-issue 1` (issue #1 is already closed — safe test target).

Expected: Claude fetches the issue, labels it `bug`, posts an opening comment on the issue, adds it to the project board, and proceeds with the fix workflow. Since the issue is already closed and the fix may already exist, the agent may create a PR or bail cleanly — both are acceptable outcomes.

> Note: This is a live run against the real repo. If you want to avoid any side effects, inspect the command file content manually and skip this step.
