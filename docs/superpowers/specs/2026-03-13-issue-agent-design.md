# Issue Agent — Design Spec

**Date:** 2026-03-13
**Status:** Approved

---

## Overview

A Claude Code slash command that takes a GitHub issue number, triages it, attempts to fix the underlying bug, and moves the issue through the Project board — all from within Claude Code CLI or VS Code.

**Invocation:**
```
/fix-issue <issue-number>
```

**Repo:** `darkharasho/gw2builds`

---

## Goals

- Triage an issue (auto-label based on content)
- Move the issue to "In Progress" on the GitHub Project board
- Post an opening diagnostic comment
- Explore the codebase, identify the root cause, and fix it
- Run tests to verify the fix
- Create a branch + PR linking the issue
- Move to "Done" on success; leave "In Progress" with a summary comment on failure

---

## Non-Goals

- Running automatically (no webhooks, no scheduled triggers)
- Handling multiple issues in one invocation
- Handling feature requests or design changes (fix bugs only)

---

## Architecture

### Single file

```
.claude/commands/fix-issue.md
```

No new dependencies, no changes to `package.json` or `.env`. The command uses Claude Code's built-in tools (`Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep`) and the `gh` CLI (already authenticated) for all GitHub and Git operations.

### Tool usage

| Operation | Tool |
|---|---|
| Read source files | `Read`, `Glob`, `Grep` |
| Fix source files | `Edit`, `Write` |
| Run tests | `Bash` (`npm test`) |
| Git operations | `Bash` (`git checkout -b`, `git commit`, `git push`) |
| GitHub issue/PR ops | `Bash` (`gh issue edit`, `gh pr create`, `gh api`) |
| Project board ops | `Bash` (`gh project item-list`, `gh project item-edit`) |

---

## GitHub Project Board IDs

These are hardcoded in the command file to avoid dynamic lookup overhead:

| Field | Value |
|---|---|
| Project ID | `PVT_kwHOCJlSRs4BRf9t` |
| Status field ID | `PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg` |

| Status | Option ID |
|---|---|
| To triage | `f971fb55` |
| Up next | `4ceeb31c` |
| In progress | `5ef0dc97` |
| Done | `98236657` |

---

## Workflow

```
/fix-issue <N>
    │
    ├─ 1. Fetch issue via `gh api repos/darkharasho/gw2builds/issues/<N>`
    │      Bail early if not found or if gh CLI is not authenticated.
    │      Compute slug from issue title (first 4–5 words, lowercase, hyphenated).
    │      Slug is reused in steps 4 and 6.
    │
    ├─ 2. Auto-label: analyze title+body, apply label (bug / enhancement / question)
    │      via `gh issue edit <N> --add-label <label>`
    │      If label resolves to anything other than "bug": bail with
    │      "Issue is not a bug — aborting fix agent."
    │
    ├─ 3. Add issue to Project board (idempotent) + move to "In progress"
    │      a. `gh project item-add 1 --owner darkharasho \`
    │            `--url https://github.com/darkharasho/gw2builds/issues/<N>`
    │         → captures item `id` from returned JSON
    │      b. `gh project item-edit --project-id PVT_kwHOCJlSRs4BRf9t \`
    │            `--id <item-id> --field-id PVTSSF_lAHOCJlSRs4BRf9tzg_T1Jg \`
    │            `--single-select-option-id 5ef0dc97`
    │
    ├─ 4. Post opening comment:
    │      "🤖 **Issue agent investigating.**
    │       Hypothesis: <one-line root cause guess>.
    │       Branch: `fix/issue-<N>-<slug>`. Will post results when complete."
    │
    ├─ 5. Explore codebase (Glob, Grep, Read) to find root cause
    │
    ├─ 6. Check for existing branch:
    │      `git ls-remote --heads origin fix/issue-<N>-*`
    │      If exists: check it out and reuse. If not: create it.
    │      Branch name: `fix/issue-<N>-<slug>` (slug = first 4–5 title words,
    │      lowercase, hyphenated)
    │
    ├─ 7. Fix the bug (Edit / Write)
    │
    ├─ 8. Run `npm test`. On failure: revise fix and retry once more (max 2 attempts).
    │      If still failing after 2 attempts: proceed to failure path.
    │
    ├─ 9. Check for existing PR:
    │      `gh pr list --head fix/issue-<N>-<slug> --json url`
    │      If exists: capture URL, skip creation.
    │      If not: `gh pr create --title "fix: <issue title> (closes #<N>)" \`
    │               `--body "..."`
    │
    └─ 10. On success: move to "Done" (option ID 98236657), post closing comment
               with PR link. End response with "PR opened: <url>".
           On failure: leave "In progress", post summary of what was tried.
               End response with "Could not fix: <one-line reason>".
```

---

## Codebase Context (baked into command)

The command file includes a codebase map so Claude doesn't need to discover structure:

- **Main process:** `src/main/` — Electron main, GW2 API fetching (`gw2Data.js`)
- **Renderer:** `src/renderer/renderer.js` — all UI logic; `src/renderer/styles.css` — all styles
- **Tests:** `tests/`
- **Run tests:** `npm test`

---

## Branch & PR Conventions

| Field | Value |
|---|---|
| Branch name | `fix/issue-<N>-<slug>` (slug = lowercase hyphenated title words) |
| PR title | `fix: <issue title> (closes #<N>)` |
| PR body | Summary of root cause + fix approach + `Closes #<N>` |

---

## Outcome Signaling

The command instructs Claude to end its final response with:

- **On success:** `PR opened: <url>`
- **On failure:** `Could not fix: <one-line reason>`

This makes outcome detection unambiguous.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Issue not found | Bail early with clear error message |
| `gh` CLI not authenticated | Bail early with "Run `gh auth login` first" |
| Issue is not a bug | Bail after labeling with "Issue is not a bug — aborting fix agent" |
| Branch already exists remotely | Check out existing branch, continue from there |
| Tests failing after 2 fix attempts | Proceed to failure path, post summary of what was tried |
| PR already exists for this branch | Capture existing URL, skip `gh pr create`, move to Done |

---

## File Structure

```
.claude/
  commands/
    fix-issue.md     ← new (directory also needs to be created)
```

No other files added or modified.
