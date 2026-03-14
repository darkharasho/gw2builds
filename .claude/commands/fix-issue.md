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
- Compute a **slug** from the issue title: take the first 4–5 words, lowercase, strip non-alphanumeric characters (except hyphens), hyphenate, max 40 characters.
  Example: "Cant select any stats on equipment" → `cant-select-any-stats`
  Minimum 2 words. Reuse this slug unchanged in Steps 4 and 6.

### Step 2 — Auto-label

Analyze the issue title and body. Choose exactly one label: `bug`, `enhancement`, or `question`.

```bash
gh issue edit $ARGUMENTS --repo darkharasho/axiforge --add-label <label>
```

If the label is **not** `bug`: stop with "Issue is not a bug — aborting fix agent."

(The label is still applied intentionally for triage purposes — the human can see it was triaged.)

### Step 3 — Add to Project board + move to "In progress"

**3a. Add issue to project (idempotent — safe to run if already added):**

```bash
gh project item-add 1 --owner darkharasho \
  --url https://github.com/darkharasho/axiforge/issues/$ARGUMENTS \
  --format json
```

Capture the `id` field from the JSON response. This is the **item ID** used in 3b and Step 11.

> **Remember this item ID — you will need it again in Step 11.**

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

If the root cause cannot be identified after 3–4 targeted searches, go to the **Failure Path**.

### Step 6 — Create or reuse branch

Check whether the fix branch already exists remotely:

```bash
git fetch origin 2>/dev/null || true
git ls-remote --heads origin fix/issue-$ARGUMENTS-<slug>
```

- If it exists: `git checkout fix/issue-$ARGUMENTS-<slug>`
- If not: `git checkout -b fix/issue-$ARGUMENTS-<slug>`

### Step 7 — Write test coverage

**Before writing the fix**, add test(s) that reproduce the bug. The test(s) should:

1. Fail before the fix is applied (confirming the bug exists)
2. Pass after the fix is applied

Place tests in the appropriate file under `tests/`. If no suitable file exists, create one following existing naming conventions (e.g. `tests/<module>.test.js`).

Run `npm test` to confirm the new test(s) fail as expected. If they pass already, the test isn't capturing the bug — revise it.

### Step 8 — Fix the bug

Use `Edit` or `Write` to fix the root cause. Make targeted, minimal changes. Do not refactor unrelated code.

### Step 9 — Run tests (max 2 attempts)

```bash
npm test
```

All tests (including the new ones from Step 7) must pass.
If tests fail: revise the fix and run once more.
If they still fail after 2 attempts: go to the **Failure Path** below.

### Step 10 — Manual test checkpoint

**Stop and ask the user to manually test the fix before proceeding.**

Tell the user:
1. What was changed and why
2. How to reproduce the original bug
3. What they should verify is now working

Then ask: "Please test this and let me know if the fix looks good, or if anything needs adjusting."

**Wait for user confirmation before continuing.** If the user reports issues, revise the fix (go back to Step 8) and re-run tests.

### Step 11 — Commit + push

```bash
git add src/ tests/
git commit -m "fix: <issue title> (closes #$ARGUMENTS)"
git push -u origin fix/issue-$ARGUMENTS-<slug>
```

(Use the actual issue title fetched in Step 1, not the literal text `<issue title>`.)

### Step 12 — Open PR (or find existing)

Check for an existing PR on this branch:

```bash
gh pr list --repo darkharasho/axiforge \
  --head fix/issue-$ARGUMENTS-<slug> \
  --state open \
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

### Step 13 — Move to "Done" + close out

Use the item ID you captured in Step 3a.

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
2. Push the WIP branch so it is inspectable:

```bash
git push -u origin fix/issue-$ARGUMENTS-<slug> 2>/dev/null || true
```

3. Post a comment:

```bash
gh issue comment $ARGUMENTS --repo darkharasho/axiforge \
  --body "🤖 **Could not fix automatically.**
What I tried: <summary of approaches>
Why it failed: <specific reason>"
```

4. End your response with: `Could not fix: <one-line reason>`
