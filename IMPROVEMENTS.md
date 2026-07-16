# MD Todo — Candidate Improvements (v1.4.2 audit, reconciled)

## Reconciliation — 2026-07-15

This file is a **historical audit** produced against `6f90d92` (tag `v1.4.2`),
when the extension was a single 3,376-line `extension.ts`. All `extension.ts:NNN`
line anchors in the original text below refer to that v1.4.2 monolith, which no
longer exists — the source now lives in a layered `src/` tree (see
`Docs/tdd/enterprise-restructure.md` and the README's Architecture section).

The tables below record the accurate status of every item as of the completion
of the enterprise-restructure migration (2026-07-15):

- **Done** — shipped, with the release or migration phase that shipped it.
- **Still open** — a valid backlog idea, not yet implemented. New work on any
  of these starts with a TDD under `Docs/tdd/` — do not implement from this
  file's sketches alone; the anchors and code assumptions are stale.
- **Dropped** — deliberately not pursued, with the reason.

Tally: **38 Done · 40 Still open · 3 Dropped** (81 items from the original
v1.4.2 audit). One further item, Code-12, was added 2026-07-16 from the
restructure's own closure review and falls outside that original tally.

The original prose is preserved unchanged below the status tables as the
historical record. Where statuses reference migration phases (Phase 0–6,
F-nn findings), see the Migration Status table and findings list in
`Docs/tdd/enterprise-restructure.md`.

### 1. Features users would notice (Feat)

| Id      | Item                                | Status                                                  |
| ------- | ----------------------------------- | ------------------------------------------------------- |
| Feat-1  | Inline checkbox click toggles done  | Still open                                              |
| Feat-2  | `#tag` hover (parity with `@user`)  | Still open                                              |
| Feat-3  | Priority field                      | Still open                                              |
| Feat-4  | Due dates                           | Still open                                              |
| Feat-5  | Recurring todos                     | Still open (audit itself recommended deferring)         |
| Feat-6  | Snooze / defer-until                | Still open                                              |
| Feat-7  | Cross-file aggregation              | Still open (single-file scope now documented in README) |
| Feat-8  | Workspace-wide search command       | Still open                                              |
| Feat-9  | Export reports (copy/save buttons)  | Still open                                              |
| Feat-10 | GitHub Issues / Linear integration  | Still open (audit itself flagged as backlog-only)       |
| Feat-11 | Drag-and-drop reorder in tree views | Still open                                              |
| Feat-12 | "Open Today's Standup" command      | Still open                                              |

### 2. UX polish (UX)

| Id    | Item                                         | Status                                                 |
| ----- | -------------------------------------------- | ------------------------------------------------------ |
| UX-1  | Update stale README Workflow shortcuts       | Done — Phase 6 of the restructure (2026-07-15)         |
| UX-2  | Keybindings for more commands                | Still open                                             |
| UX-3  | Hide status-bar items when no focus set      | Still open                                             |
| UX-4  | Combined counts on tree root labels          | Still open                                             |
| UX-5  | "Open Todo File" quick-pick command          | Still open                                             |
| UX-6  | Tree welcome links include Initialize        | Still open                                             |
| UX-7  | Configurable Add Item insert position        | Still open                                             |
| UX-8  | Configurable focus/tag/mention colours       | Still open (same as A11y-1)                            |
| UX-9  | `matchOnDescription` on Add/Edit Tags picker | Still open (verified absent in `commands-add-tags.ts`) |
| UX-10 | Item-count status bar item                   | Still open                                             |

### 3. Format / data model (Fmt)

| Id    | Item                              | Status                                        |
| ----- | --------------------------------- | --------------------------------------------- |
| Fmt-1 | "Last touched" `~date` timestamp  | Still open                                    |
| Fmt-2 | Custom section names              | Still open (audit itself flagged as niche)    |
| Fmt-3 | Block references / parent linkage | Still open (audit itself flagged as doubtful) |
| Fmt-4 | Time estimates (`~2h`)            | Still open                                    |
| Fmt-5 | Strict format mode (diagnostics)  | Still open                                    |
| Fmt-6 | JSON / CSV export of parsed doc   | Still open                                    |

### 4. Performance (Perf)

| Id     | Item                                        | Status                                                           |
| ------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Perf-1 | Memoize `parseDocument` by `(uri, version)` | Done — v1.4.4                                                    |
| Perf-2 | Skip re-parse on whitespace-only changes    | Done — v1.4.4                                                    |
| Perf-3 | Incremental decoration updates              | Done — v1.4.4 (dim full-scans by design; formalized in Phase 3b) |
| Perf-4 | Completion-provider parse caching           | Done — v1.4.4 (via the parse cache)                              |
| Perf-5 | Tree refresh re-parse                       | Done — v1.4.4 (via the parse cache)                              |
| Perf-6 | Status-bar refresh re-parse                 | Done — v1.4.4 (via the parse cache)                              |

### 5. Code quality / maintainability (Code)

| Id      | Item                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code-1  | Split `extension.ts` into modules           | Done — v1.4.3 (flat split); layered architecture in restructure Phases 1–4                                                                                                                                                                                                                                                                                                                               |
| Code-2  | `execFile` for git calls                    | Done — Phase 4 (F-08)                                                                                                                                                                                                                                                                                                                                                                                    |
| Code-3  | Centralise the "Not a todo file" guard      | Done — Phase 3a (F-09): `requireTodoEditor` in `src/vscode/guards.ts`                                                                                                                                                                                                                                                                                                                                    |
| Code-4  | Dedupe the tree providers                   | Done — Phase 3c (F-02): `GroupingTreeProvider` + descriptors                                                                                                                                                                                                                                                                                                                                             |
| Code-5  | Delete no-op `getEffectiveEditor`           | Done — Phase 3a (F-10)                                                                                                                                                                                                                                                                                                                                                                                   |
| Code-6  | Decoration types: dispose + de-globalize    | Done — Phase 3b (F-03/F-12): `DecorationController`, `context.subscriptions`                                                                                                                                                                                                                                                                                                                             |
| Code-7  | Extract `activate()` into setup helpers     | Done — Phase 4: declarative registry in `src/registrations/`                                                                                                                                                                                                                                                                                                                                             |
| Code-8  | `processTagsWithValidation` over-engineered | Still open (unchanged, in `src/vscode/prompts.ts`)                                                                                                                                                                                                                                                                                                                                                       |
| Code-9  | `markItemDone` single atomic edit           | Done — Phase 4 (F-07): `EditPlan` + one `WorkspaceEdit`                                                                                                                                                                                                                                                                                                                                                  |
| Code-10 | `insertLine! ?? 0` cleanup                  | Done — resolved during the module split/restructure (expression no longer exists)                                                                                                                                                                                                                                                                                                                        |
| Code-11 | Initialize template lacks `## Users`        | Still open (template gained `## Projects` in v1.5.0, still no `## Users`)                                                                                                                                                                                                                                                                                                                                |
| Code-12 | Multi-change incremental decoration drop    | Still open — newly found 2026-07-16 during the restructure's closure review, pre-existing in `main` (not a regression): a single edit event with multiple `contentChanges` at different lines (e.g. multi-cursor) can compute a stale rescan line range for a later change, silently dropping its decorations until the next full scan; see `Docs/tdd/enterprise-restructure.md` Decision Log 2026-07-16 |

### 6. Testing (Test)

| Id     | Item                                    | Status                                                                                 |
| ------ | --------------------------------------- | -------------------------------------------------------------------------------------- |
| Test-1 | `@vscode/test-electron` + mocha harness | Dropped — vitest + a `vscode` alias mock chosen instead (v1.5.0; see TDD Alternatives) |
| Test-2 | Unit-test the pure functions            | Done — v1.5.0 started; restructure Phases 2 + 5 (mock-free `test/unit/`)               |
| Test-3 | Integration tests for mutating commands | Done — Phases 4–5 (mark-done matrix, archive, add-note, assign-user)                   |
| Test-4 | Snapshot tests for activity reports     | Done — Phase 5 (fixed-clock markdown snapshots)                                        |
| Test-5 | CI test wiring                          | Done — v1.5.0 (vitest in CI; no xvfb needed with the mock approach)                    |

### 7. CI / release (CI)

| Id   | Item                                      | Status                                                                      |
| ---- | ----------------------------------------- | --------------------------------------------------------------------------- |
| CI-1 | Lint + type-check as PR-blocking jobs     | Done — Phase 0                                                              |
| CI-2 | markdownlint in CI                        | Done — Phase 0                                                              |
| CI-3 | Node version matrix                       | Done — Phase 0 (Node 20 + 24, matching `engines`; 22 not exercised)         |
| CI-4 | Cross-platform (OS) matrix                | Still open — CI remains ubuntu-only; Windows verified via manual VSIX smoke |
| CI-5 | Verify `package.json` version matches tag | Still open                                                                  |
| CI-6 | `vsce` package smoke on PRs               | Done — packaging on every PR existed at baseline and is retained            |
| CI-7 | CHANGELOG-entry enforcement               | Still open                                                                  |
| CI-8 | SHA-256 checksum on releases              | Still open                                                                  |
| CI-9 | Dependabot                                | Done — Phase 0 (`.github/dependabot.yml`, npm + github-actions weekly)      |

### 8. Documentation (Docs)

| Id     | Item                                    | Status                                                                          |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| Docs-1 | Fix stale Workflow shortcuts            | Done — Phase 6                                                                  |
| Docs-2 | Stale VSIX version reference            | Done — Phase 1 (`md-todo-<version>.vsix` placeholder)                           |
| Docs-3 | Activity commands in the Commands table | Done — added in an earlier release; verified complete Phase 6                   |
| Docs-4 | Screenshots / demo GIF                  | Still open (explicitly out of the restructure's scope)                          |
| Docs-5 | Notes-format conventions documentation  | Still open (auto-date now documented; note indent/archive semantics still thin) |
| Docs-6 | Document auto-date-on-Enter             | Done — Phase 6 (README "Automatic date on Enter")                               |
| Docs-7 | Marketplace badges                      | Still open                                                                      |
| Docs-8 | "Limitations" section                   | Done — Phase 6 (README "Limitations / Known Behaviors")                         |

### 9. Accessibility / theming (A11y)

| Id     | Item                              | Status                                                 |
| ------ | --------------------------------- | ------------------------------------------------------ |
| A11y-1 | Hardcoded tag/mention/dim colours | Still open (same as UX-8)                              |
| A11y-2 | Configurable dim opacity          | Still open                                             |
| A11y-3 | Status-bar tooltip phrasing       | Dropped — audit itself concluded "mostly already fine" |
| A11y-4 | Tree-label icon reliance          | Dropped — audit itself concluded "likely fine"         |

### 10. Robustness (Robust)

| Id        | Item                                     | Status                                                                 |
| --------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Robust-1  | `getToday()` timezone mismatch           | Done — Phase 2 (F-06): all date logic agrees on local time             |
| Robust-2  | `child_process.exec` with quoted path    | Done — Phase 4 (F-08): `execFile` with argv                            |
| Robust-3  | Code fences / HTML comments match tokens | Done — Phase 5 (F-17): line-granular exclusion in parser + decorations |
| Robust-4  | `markItemDone` two-step edit not atomic  | Done — Phase 4 (F-07): single `WorkspaceEdit`                          |
| Robust-5  | `isTodoFile` 20-line frontmatter limit   | Done — the "document it" option: README Limitations section (Phase 6)  |
| Robust-6  | Sectionless-file fallback paths untested | Still open (`addItem` fallback insert path remains lightly covered)    |
| Robust-7  | Mixed-case `[X]` checkbox inconsistency  | Done — Phase 4 (F-16): writes normalize to lowercase `x`               |
| Robust-8  | `addTags` replace-all strips lookalikes  | Still open                                                             |
| Robust-9  | `assignFocusedUser` trailing-space edge  | Done — Phase 5: pinned by tests (trailing-token case covered)          |
| Robust-10 | Decoration types not disposed            | Done — Phase 3b (F-12): disposal via `context.subscriptions`           |

---

## Original audit (historical record — v1.4.2 line anchors)

## Scope

- **Analyzed at:** `6f90d92` (tag `v1.4.2`), on `origin/main`, checked out as detached HEAD.
- **Surface area covered:** the single-file extension (`extension.ts`, 3,376 lines), `package.json` contributions, `README.md`, `CHANGELOG.md`, `example-todo.md`, `.github/workflows/{ci,release}.yml`, `tsconfig.json`, `.vscodeignore`, `.markdownlint.json`, `media/`.
- **Explicitly excluded:**
  - The pending README ToDO item *"consider ways in markdown renderers to give the tags and dates a separate text color/font/highlight"* (`README.md:363`). That work is in flight on `markdown-render-tag-date-styling` and is being reviewed separately.
  - Code changes that would conflict with whatever lands from that branch (e.g. new `media/` CSS bundling).
- **No files were modified.** The detached checkout was used purely for reading the v1.4.2 sources.

## High-leverage picks

These are the five items I'd reach for first. Each is high impact relative to effort, and they unblock or de-risk later work.

1. **Code-1 — Split `extension.ts` into modules.** Until this happens, every other meaningful refactor (tests, perf caching, code reviews) costs more than it should. 3,376 LOC in one file means the LLM that wrote it has a hard time fitting it in context and you have a hard time reading it.
2. **Test-1 — Stand up a unit test harness for the pure functions.** `parseDocument`, `parseNaturalDateRange`, `getItemEndLine`, `validateTags`, `itemMatchesActivity` are all pure and parser-shaped — the bug class they hide gets expensive without a safety net. Easier once Code-1 is done; not blocking.
3. **Perf-1 — Memoize `parseDocument` per `(uri, version)`.** Each keystroke parses the document 3–6 times (tag/date/mention/dim decorations + both tree providers). Costs nothing semantically and makes the dim/decoration code feel instant on long files.
4. **Robust-1 — Fix the `getToday()` vs `parseDate()` timezone mismatch.** `getToday` uses UTC (`toISOString().split('T')[0]`); `parseDate` builds a local-time `Date`. Late-evening users in negative UTC offsets will see tomorrow's date written into their todos and off-by-one staleness/archive math. Low effort, real bug.
5. **CI-1 — Add lint + type-check + markdownlint as PR-blocking jobs.** The repo already has `.markdownlint.json` and a recent "tightened TypeScript lint configuration" entry in the changelog, but nothing in `ci.yml` actually runs lint or a separate type-check pass. Easy gates that pay back forever.

Honourable mention: **Feat-7 — Workspace-wide multi-file support.** Today the trees and "Last todo URI" assume a single file; many users keep a per-project todo and a personal one. This is bigger but unlocks a different mode of using the extension.

---

## 1. Features users would notice

1. **Inline checkbox click toggles done.** Currently the only ways to mark done are the command, keybinding chord, or right-click in a tree. A `CodeLens` (or a `link`/`inline action` on the checkbox glyph) that lets the user click `[ ]` / `[x]` in the editor would match how every other markdown todo extension works. *Why it matters:* the most common action becomes one click. *Effort:* M. *Anchor:* new `MdTodoCodeLensProvider` registered in `extension.ts:activate`, integrating with existing `markItemDone` at `extension.ts:532`.
2. **Show `#tag` hover.** `@user` has a hover (`extension.ts:3058 userHoverProvider`), but `#tag` does not. Hover should display the tag description from `## Tags`. *Why it matters:* parity with `@user`, removes a known asymmetry. *Effort:* S. *Anchor:* new `tagHoverProvider`, register at `extension.ts:3184` next to `userHoverProvider`.
3. **Priority field.** Add a `!high` / `!med` / `!low` (or `!1` / `!2` / `!3`) inline marker, parsed like tags. Status bar can show a "high-priority active count"; tree views can group/sort by priority. *Why it matters:* the format is "git-friendly + plain markdown," but priority is the single most-asked-for feature for any todo system. *Effort:* M. *Anchor:* `TodoItem` interface at `extension.ts:11`, parser at `extension.ts:219`, decoration code at `extension.ts:1308–1349`.
4. **Due dates.** Add a `→YYYY-MM-DD` (or `due:`) field with its own decoration colour and a "Show Due This Week" command analogous to "Show Stale Items". Could re-use the `Activity Focus` plumbing at `extension.ts:1628+`. *Why it matters:* differentiates a todo from a note; lets the extension answer "what's coming up." *Effort:* M. *Anchor:* parser + activity focus extension.
5. **Recurring todos.** A `~weekly` / `~daily` / `~every-2-weeks` marker that, when the item is marked done, clones a fresh `[ ]` copy with today's `+date` into Active. *Why it matters:* covers the standing "1:1 prep" / "weekly review" workflow without forcing duplication. *Effort:* M. *Anchor:* `markItemDone` at `extension.ts:532`. Probably **not worth it as a first cut** — it changes the file-shape contract and complicates archive semantics. Worth flagging but defer.
6. **Snooze / defer-until.** A `⏰YYYY-MM-DD` (or `wait:YYYY-MM-DD`) marker that dims an item until the date arrives, then auto-undims. *Why it matters:* lets the user keep one big Active list without it overwhelming them. *Effort:* M. *Anchor:* dim logic at `extension.ts:1568+`, status-bar at `1664`.
7. **Cross-file aggregation.** Today the user can have only one "active" todo file at a time (`lastTodoUri` at `extension.ts:1483`, plus the tree providers each storing one URI). Many people keep `team-todo.md` and `personal-todo.md` open. Aggregate the tree views across all open mdtodo docs, grouped by file. *Why it matters:* once you have more than one mdtodo file, this is the feature that converts the extension from "useful" to "load-bearing." *Effort:* L. *Anchor:* `MdTodoUsersTreeProvider.currentUri` at `extension.ts:2247`, `MdTodoTagsTreeProvider.currentUri` at `extension.ts:2609`, plus the completion providers at `extension.ts:3076` and `extension.ts:3103`.
8. **Workspace-wide search command.** `MD Todo: Find Item` — fuzzy-pick across every active item in every open mdtodo doc. *Why it matters:* `Cmd+P` doesn't know about todos; this is the keyboard shortcut to "where did I put that". *Effort:* S after Feat-7, M before. *Anchor:* new command in `activate`.
9. **Export reports.** The "Show Recently Completed / Added / Stale" commands already render a markdown buffer (`extension.ts:1937`). Add `Copy as Markdown` / `Copy as CSV` / `Save to file` buttons (via QuickPick item or a `CodeAction`-style button). *Why it matters:* turns the existing ad-hoc reports into something that goes into a weekly update or status email. *Effort:* S. *Anchor:* `openActivityReport` at `extension.ts:1845`.
10. **GitHub-Issues / Linear integration.** A `Convert to GitHub Issue` command on a todo. Probably **nice-to-have-but-not-now**: it changes the extension from "local" to "service-bound" and requires PAT plumbing. Flag for the backlog.
11. **Drag-and-drop reorder in the tree views.** Implement `TreeDragAndDropController` on the users and tags trees so users can drag an item to a different user/tag. *Why it matters:* the trees are currently strictly read-mostly. *Effort:* M. *Anchor:* `MdTodoUsersTreeProvider` at `extension.ts:2243`, `MdTodoTagsTreeProvider` at `extension.ts:2605`.
12. **`MD Todo: Open Today's Standup` command.** Pre-baked report = items completed since *yesterday's standup* + items added today + open items mentioning the current user. *Why it matters:* the extension already has all the parts (date filter, focus user, activity report). Composing them into a single shortcut is the win. *Effort:* S. *Anchor:* new command, reuses `openActivityReport` at `extension.ts:1845`.

---

## 2. UX polish

1. **Update stale README shortcuts in "Workflow".** `README.md:324–326` still says `Ctrl+Shift+A`, `Ctrl+Shift+D`, `Ctrl+Shift+N` for the daily flow — those are wrong; the actual chord keybindings are `Ctrl+Shift+T T/D/N` (`package.json:262–311`). New users following the README will hit nothing. *Why it matters:* first-time impression. *Effort:* S. *Anchor:* `README.md:319–334`.
2. **Add keybindings for the rest of the commands.** Today only 8 of 26 commands have shortcuts (`package.json:262–311`). `mdTodo.showStats`, `mdTodo.showRecentlyCompleted`, `mdTodo.showRecentlyAdded`, `mdTodo.showStaleItems`, `mdTodo.quickAdd`, and `mdTodo.clearActivityFocus` are obvious candidates. *Why it matters:* the existing `Ctrl+Shift+T <chord>` pattern is consistent; extending it costs nothing. *Effort:* S. *Anchor:* `package.json:262`.
3. **Hide the user / tag / activity status-bar items when no focus is set.** They currently show `$(person) All users` / `$(tag) All tags` / `$(calendar) All time` (`extension.ts:1527, 1548, 1659`) even when not in use, occupying three status-bar slots permanently. Either hide them entirely or collapse to one icon when all are "All". *Why it matters:* status bar real estate; three perma-pinned items feels heavy. *Effort:* S. *Anchor:* `refreshFocusStatusBar`/`refreshFocusTagStatusBar`/`refreshActivityFocusStatusBar`. **Tradeoff:** discoverability — they're how the user *finds* the focus feature in the first place. Suggest making it a setting.
4. **Tree view "show counts in section headers".** The tree displays e.g. `Active (3)` (`extension.ts:2336`), which is good. But the *root* user/tag node shows only `(N active)` and not completed/archive — the tooltip has it (`extension.ts:2312`). Surface a single combined count on the root label so you don't need to hover. *Effort:* S. *Anchor:* `getTreeItem` at `extension.ts:2302` and `extension.ts:2663`.
5. **`MD Todo: Open Todo File` quick-pick.** When the user has set "last todo URI" in workspace state (`extension.ts:1483`), a one-click command to jump back to it would be useful — especially since the trees and completions silently target this URI but the user has no way to see which file it is. *Why it matters:* makes the implicit "last mdtodo doc" model explicit. *Effort:* S. *Anchor:* new command, reads `LAST_TODO_URI_STATE_KEY` at `extension.ts:1452`.
6. **Tree welcome links: include "Initialize Todo File".** `viewsWelcome` (`package.json:185`) currently says "Open a todo file (markdown with `md-todo: true` frontmatter) to see users." Adding a `[Initialize new todo file](command:mdTodo.initialize)` link drops one step for first-run users. *Effort:* S. *Anchor:* `package.json:185`.
7. **`Add Item` insert position should be configurable.** It always inserts at the top of `## Active` (`extension.ts:451`). Some users want to append to the bottom; some want to insert at the cursor (that's `quickAdd`, but it doesn't auto-fill text). Add a `mdTodo.addItemPosition` setting: `top` / `bottom` / `cursor`. *Effort:* S. *Anchor:* `addItem` at `extension.ts:424`.
8. **Configurable focused colours.** Tag colour is hardcoded `charts.purple` (`extension.ts:1319`), mention colour `charts.blue` (`extension.ts:1416`), dim opacity `0.25` (`extension.ts:1511`). Expose `mdTodo.tagColor`, `mdTodo.mentionColor`, `mdTodo.dimOpacity` as either `string | ThemeColor` settings or as colour-customisation entries (`contributes.colors`). *Why it matters:* high-contrast / light-theme users; a11y. *Effort:* S. *Anchor:* `package.json:contributes.configuration` + `package.json:contributes.colors` (new), decoration creators in `extension.ts`.
9. **`Set Tag Focus` / `Set Focus User` should `matchOnDescription` for tag too.** Setting `matchOnDescription: true` on `setFocusTag` (`extension.ts:2098`) — already there. But the `Add/Edit Tags` multi-select picker (`extension.ts:1095`) doesn't enable description matching. *Why it matters:* CHANGELOG 1.1.1 already established "fuzzy-match across all fields" as the bar; this multi-select hasn't been updated. *Effort:* S. *Anchor:* `extension.ts:1095–1098`.
10. **Item-count budgeting in the status bar.** A small `$(checklist) 7` showing the active-item count (or, more usefully, "items added today / items completed today"). *Why it matters:* the existing focus indicators are filter-shaped; this is daily-progress-shaped. *Effort:* S. *Anchor:* new status bar item next to those at `extension.ts:3153`.

---

## 3. Format / data model

1. **Distinguish "added" from "modified".** Currently a `+date` is added once; if the item is significantly rewritten, there's no history apart from git. Add an optional `~YYYY-MM-DD` "last touched" timestamp updated on edits. *Why it matters:* would let "Show Stale Items" pick up items that were touched recently but not completed. *Effort:* M. *Anchor:* `TodoItem` interface at `extension.ts:11`, auto-add-date handler at `extension.ts:3260`. **Cost:** more dates on each line; consider making this opt-in.
2. **Custom section names.** Hard-coded `'active' | 'completed' | 'archive' | 'tags' | 'users'` (e.g. `extension.ts:448`, `extension.ts:1210`, `extension.ts:2234`). Some users will want `## Now`, `## Next`, `## Later` (the Now-Next-Later format), or sprint-style sections. Allow a `frontmatter.mdTodoSections: ["Now", "Next", "Later"]` to override. *Why it matters:* dogfoods better, but probably **niche** — most users will keep the defaults. *Effort:* L if done right. Flag.
3. **Block references / parent linkage.** Today nesting is purely visual (indentation). Allow `^id` markers and `→^id` references so todo A can declare it blocks B. *Why it matters:* unlocks "what's blocking the release" queries. *Effort:* L. **Likely not worth it** unless feedback specifically asks for it; the format is plain-markdown by design.
4. **Estimates (`~2h`).** Optional time-estimate marker; "Show Stats" already does avg completion time — add average-estimated-vs-actual. *Why it matters:* meta-productivity, gives users a reason to keep using the extension. *Effort:* S. *Anchor:* parser + `showStats` at `extension.ts:857`.
5. **Strict format mode.** A configuration setting that warns / red-squiggles when items don't have an `+date`, mention an undefined `@user`, or use undefined `#tag`. Today undefined tags are auto-created (`extension.ts:181 promptCreateTags`); the symmetric check for `@user` exists nowhere. *Why it matters:* catches typos; converts the loose format into a stricter contract for teams. *Effort:* M. *Anchor:* new `vscode.DiagnosticCollection` registered in `activate`.
6. **JSON / CSV export of the parsed document.** A `MD Todo: Export…` command emitting the parsed `ParsedDocument` (`extension.ts:39`) as structured data. *Why it matters:* downstream automation, weekly digests, BI tools. *Effort:* S. *Anchor:* new command, uses `parseDocument` directly.

---

## 4. Performance

1. **Memoize `parseDocument`.** Called 32× in the file (grep `parseDocument`). On a single keystroke the four decoration updaters and both tree providers each re-parse the same document at the same `version`. For a 1,000-line file the parse is cheap but the inputs are O(N) regex scans — multiply by 6 and it shows. Cache keyed on `(document.uri.toString(), document.version)` with a 1-entry-per-doc LRU. *Why it matters:* makes typing in big files feel native again. *Effort:* S. *Anchor:* `extension.ts:219`. **Sharpest single perf win.**
2. **Don't re-parse on `onDidChangeTextDocument` if the change is purely whitespace.** Combined with Perf-1, this would also help. *Effort:* S. *Anchor:* `extension.ts:3349`, `extension.ts:3217`.
3. **Decorator updates do full O(N) document scans.** `updateTagDecorations`, `updateDateDecorations`, `updateMentionDecorations`, `updateDimDecorations` (all in `extension.ts:1325`, `1374`, `1422`, `1568`) walk every line of the document on every change. VS Code's decoration API can be incrementally updated; for big files (10K lines) this will stutter. *Why it matters:* mid-size docs already feel snappy; large docs are where this would bite. **Probably not urgent** — defer unless users actually hit slowdowns. *Effort:* M.
4. **Completion provider is registered against `*`.** `extension.ts:3178` and `extension.ts:3187` register against any document, triggered on `#` / `@`. On every match the provider opens a `TextDocument` via `getLastTodoSourceDoc` and re-parses it. If the user types a lot of `@`s in chat or code, this is a hidden O(parse) cost. Cache `parseDocument` (Perf-1) plus a short TTL would solve it. *Effort:* S (after Perf-1). *Anchor:* `extension.ts:3076–3124`.
5. **Tree view debounce is 200ms but full refresh re-parses inside `getCurrentParsed`** (`extension.ts:2291` and `extension.ts:2652`). A single keystroke re-opens the document (`openTextDocument` returns cached, fine) and re-parses. With Perf-1 this becomes free. *Anchor:* same.
6. **Status-bar refresh parses on every `onDidChangeTextDocument` to look up the focused user's `fullname`** (`extension.ts:1531`). The fullname tooltip update could be debounced or only refreshed on definition changes. *Effort:* S. **Tiny win, only if Perf-1 doesn't ship.**

---

## 5. Code quality / maintainability

1. **Split `extension.ts` into modules.** Natural seams: `types.ts` (the 7 interfaces at top), `parser.ts` (`parseDocument`, `findItemAtCursor`, `findItemByLine`, `getItemEndLine`, helpers), `dates.ts` (`parseDate`, `daysBetween`, `parseNaturalDateRange`, `formatIsoDate`, `startOfToday`), `decorations/{tag,date,mention,dim}.ts`, `commands/{addItem,markDone,addNote,archive,addTags,manageTags,addUser,quickAdd,initialize,assignFocusedUser}.ts`, `commands/activity.ts` (the three "Show…" commands), `commands/history.ts`, `commands/stats.ts`, `treeProviders/{users,tags}.ts`, `focus/{user,tag,activity}.ts`, `prompts.ts` (`promptForTodoText`, `sortedSuggestions`, `promptCreateTags`, `processTagsWithValidation`), `extension.ts` reduced to activation glue. *Why it matters:* 3,376 LOC fights cognition; review diffs span unrelated regions; any LLM editing this routinely truncates. *Effort:* M (mostly cut-and-paste; risk is import cycles). *Anchor:* `extension.ts` entire file.
2. **Replace `child_process.exec` with `child_process.execFile` for git calls.** `showHistory` builds shell command strings with the filepath quoted (`extension.ts:806, 840`). A repo path containing a `$`, backtick, or `"` would break or be exploitable. `execFile('git', ['log', '--oneline', '--follow', '-20', '--', filePath], { cwd })` is safer and shorter. *Why it matters:* defence in depth even though file paths come from VS Code, not user input. *Effort:* S. *Anchor:* `extension.ts:803–842`.
3. **Centralise the `'Not a todo file. Add "md-todo: true"...'` warning.** 16 copies of that exact string. Create `requireTodoFile(editor): ctx | null` that handles the warning and returns null on failure. *Why it matters:* one place to change copy and behaviour. *Effort:* S. *Anchor:* `grep "Not a todo file" extension.ts`.
4. **Dedupe the two tree providers.** `MdTodoUsersTreeProvider` (`extension.ts:2243`) and `MdTodoTagsTreeProvider` (`extension.ts:2605`) are 95% the same shape — same constructor, same `setCurrentTodoFile`, same `getCurrentParsed`, same `refresh/refreshDebounced`, same `buildSectionNodes`, same `countItemsFor*`/`countU*`. Either a generic `KeyedItemsTreeProvider<TKey, TItem>` base class, or one provider parameterised over an extractor function (`(item) => string[]` for "what keys does this item belong to?"). *Why it matters:* every future change to one will require the same change to the other; this exact symmetry will absorb bugs. *Effort:* M. *Anchor:* `extension.ts:2243` and `extension.ts:2605`.
5. **`getEffectiveEditor` is a no-op now.** `extension.ts:177` — comment hints at a previous "filtered view" feature; it now just wraps `{ editor, document }`. Either delete the wrapper and the `EffectiveEditorContext` interface (`extension.ts:51`), or document what it's reserved for. *Why it matters:* removes a layer of misdirection at every command entry. *Effort:* S.
6. **Decoration types are module-level globals.** `tagDecorationType`, `dateDecorationType`, `mentionDecorationType`, `dimmedDecorationType` (`extension.ts:1308, 1356, 1408, 1457`). Bundle into a `Decorations` class disposed from `context.subscriptions`. Today they're never disposed in `deactivate()` (`extension.ts:3376`). *Why it matters:* minor leak on extension reload; the bigger payoff is testability and locality. *Effort:* S.
7. **Extract `activate()` into focused setup helpers.** It currently registers ~30 things in 250 lines (`extension.ts:3130–3374`). Helpers: `registerCommands`, `registerStatusBars`, `registerTreeViews`, `registerDecorations`, `registerCompletions`, `registerAutoDateOnEnter`. *Why it matters:* makes the activation graph readable in 20 lines. *Effort:* S.
8. **`processTagsWithValidation` is over-engineered for its current callers.** `extension.ts:205` exists to prompt the user to create undefined tags. But `addTags` uses a multi-select over already-defined tags, so undefined ones never reach this function. The `promptForTodoText` autocomplete path is the only place where undefined tags could appear, and there they're inserted as plain text. Either delete this entire chain or wire it up to the autocomplete flow. *Effort:* S. *Anchor:* `extension.ts:181–213` + call sites at `extension.ts:1104`.
9. **`markItemDone` does two separate `editor.edit()` calls.** `extension.ts:602–608` and `extension.ts:637`. If the user undoes once, they get a half-moved item. Combine into a single edit by computing both the delete-range and the insert-position before any edits (re-parse for the insert position, then construct a single `edit` builder that does both). *Effort:* M. *Anchor:* `extension.ts:532–642`.
10. **`insertLine = insertLine! ?? 0` looks wrong.** `extension.ts:461`. The non-null assertion suppresses TS while `??` catches the runtime undefined — they shouldn't both be needed. Replace with a clear default: `insertLine ??= 0`. *Effort:* S.
11. **Initialize template doesn't include `## Users`.** `extension.ts:986–1002`. The template gives `## Tags` but not `## Users`, even though the user feature is co-equal and many flows assume the section exists. *Why it matters:* discoverability. *Effort:* S.

---

## 6. Testing

There is currently **no test suite at all** (no `test/`, `__tests__/`, `*.test.ts`, `vitest.config`, `.mocharc`, etc., and the `scripts` block in `package.json` has no `test` entry).

1. **Set up `@vscode/test-electron` + `mocha` + `assert`.** The standard VS Code extension test harness. Add `npm run test` and an `out/test/` build target. *Why it matters:* it's the canonical setup; everything else assumes this. *Effort:* S. *Anchor:* new `test/` dir, `package.json` scripts.
2. **Unit-test the pure functions first.** No vscode runtime needed: `parseDate`, `daysBetween`, `isNoteLine`, `isNestedTodoLine`, `parseNaturalDateRange`, `formatIsoDate`, `startOfToday`, `validateTags`, `itemMatchesActivity`. `parseDocument` is mostly pure if you stub `vscode.TextDocument` with a simple `lineAt`/`lineCount` shim — that's where the **highest-value coverage** lives because it's the hardest to debug visually. *Effort:* S–M. *Anchor:* `extension.ts:60–366`.
3. **Integration tests for commands that mutate the document.** `markItemDone` (the four cases at `extension.ts:570–642` are exactly the matrix that wants a test), `archiveItems`, `addNoteToItem`, `assignFocusedUser` (toggle insert/remove behaviour at `extension.ts:2119`). *Why it matters:* these are the regression-prone commands. *Effort:* M.
4. **Snapshot tests for the activity reports.** `openActivityReport` (`extension.ts:1845`) renders deterministic markdown; lock the output for a few canonical inputs. *Effort:* S.
5. **CI wiring.** Add a `test` job to `.github/workflows/ci.yml` invoking `xvfb-run -a npm test` on Linux. *Effort:* S. *Anchor:* `.github/workflows/ci.yml`.

---

## 7. CI / release

1. **PR CI doesn't lint or type-check separately.** `ci.yml` runs `npm run compile` (which IS the type-check, since `tsc -p ./` is invoked) and packages a VSIX. Adding `tsc --noEmit` redundantly is unnecessary, but a `lint` step is missing. The CHANGELOG ("TypeScript and markdown lint configuration tightened" in v1.2.2) implies there are config files but no runner. *Why it matters:* `.markdownlint.json` exists and is ignored; that drift is the typical seed of doc rot. *Effort:* S. *Anchor:* `.github/workflows/ci.yml`.
2. **Run `markdownlint-cli2` (or `markdownlint-cli`) in CI.** The config (`.markdownlint.json`) sets `default: true, MD013: false`. Add a step `npx markdownlint-cli2 "**/*.md"`. *Effort:* S.
3. **Node matrix.** CHANGELOG 1.2.2 mentions Node-24 action versions; CI runs `node-version: '20'` only. `engines.node: >=20`. Test 20 / 22 / 24. *Effort:* S. *Anchor:* `ci.yml:18`.
4. **Cross-platform smoke test.** `runs-on: ubuntu-latest` only. Add a `strategy.matrix.os` over `[ubuntu, macos, windows]` for the package step — `vsce` and `tsc` can hit platform-specific edge cases. *Why it matters:* you ship to Mac/Win users. *Effort:* S.
5. **Verify `package.json.version` matches the tag in `release.yml`.** Today the workflow rewrites `package.json` from the tag (`release.yml:39`), which is fine, but if a tag is mis-applied to the wrong commit there's no guardrail. Add a check that the `version` field in `package.json` *at the tagged commit* matches the tag, fail otherwise unless `--force-version-rewrite` is set. *Effort:* S. *Anchor:* `.github/workflows/release.yml:38`.
6. **`vsce verify-pat` / `vsce ls` smoke test on PRs.** Today the marketplace publish step is the first time `vsce` sees the package in a "publish-shaped" call. Adding `vsce ls` (or `vsce package` with `--allow-missing-repository`-style strictness) on PRs catches manifest errors before tagging. The current `npx @vscode/vsce package --no-git-tag-version` on PRs (`ci.yml:29`) does most of this — verify it's strict enough. *Effort:* S.
7. **No CHANGELOG enforcement.** A PR-check that fails when `package.json` version bumps without a corresponding `CHANGELOG.md` entry is the cheapest "no silent releases" gate. Probably nice-to-have given the maintainer's diligence, but flag. *Effort:* S.
8. **GitHub Release should include a SHA-256 of the VSIX.** Several extension marketplaces and corporate firewalls care about signed/checksummed artifacts. Easy to add via `shasum` and `softprops/action-gh-release`'s `files`. *Effort:* S. *Anchor:* `release.yml:54`.
9. **Renovate / Dependabot.** No `.github/dependabot.yml` is present. The dev deps are pinned to caret ranges; Dependabot for `npm` + `github-actions` would surface upgrades without manual triage. *Effort:* S.

---

## 8. Documentation

1. **Fix stale Workflow shortcuts.** `README.md:324–326` shows `Ctrl+Shift+A/D/N`; actual is `Ctrl+Shift+T T/D/N` (chord). *Effort:* S. *Anchor:* `README.md:319–334`.
2. **Update stale VSIX version reference.** `README.md:47` reads "This creates `md-todo-1.0.0.vsix` in the project folder." Current is `1.4.2`. Either remove the version or use a placeholder like `md-todo-<version>.vsix`. *Effort:* S.
3. **Document Activity Focus commands in the Commands table.** `README.md:124–143` lists most commands but not the three "Show Recently…" / "Show Stale" / "Clear Activity Focus" rows (they exist further down in narrative form). Add them to the table for discoverability. *Effort:* S. *Anchor:* `README.md:124`.
4. **Add screenshots / a demo GIF.** Marketplace listings without visuals convert noticeably worse, and this extension has plenty to show (tree views, focus dim, status bar, decorations). *Why it matters:* drives installs. *Effort:* S (recording is the slow part).
5. **`## Notes` / progress-note conventions are under-documented.** The README mentions `- YYYY-MM-DD: text` once (`README.md:197`); nothing about how the `Add Note` command chooses indent, what happens if you add a note to an item that already has nested todos, or how notes are archived with the parent. *Effort:* S. *Anchor:* `README.md:188`.
6. **`auto-add date on Enter` behaviour isn't documented.** `extension.ts:3257–3322` adds `+today` to manually typed todos and notes when you hit Enter. This surprise-helpful behaviour deserves a paragraph (and a way to opt out). *Effort:* S.
7. **Marketplace badges.** Marketplace version, installs, rating badges in `README.md`. *Effort:* S.
8. **Add a "Limitations" / "Known gotchas" section.** Single-todo-file scope, timezone, code-block parsing (see Robust-5), no recurring todos. *Why it matters:* sets expectations. *Effort:* S.

---

## 9. Accessibility / theming

1. **Tag / mention / dim colours hardcoded.** Same content as UX-8 — included here because the **a11y angle** is distinct. `charts.purple` (`extension.ts:1319`) and `charts.blue` (`extension.ts:1416`) are reasonable defaults but a high-contrast theme user can't override them. Expose `mdTodo.*Color` settings *and* register colour contribution points via `contributes.colors` so they participate in theme customisation. *Effort:* S–M. *Anchor:* `package.json:contributes`.
2. **0.25 dim opacity may be inaccessible.** `extension.ts:1511`. For users with low vision or some forms of cognitive load, this difference is invisible; for others, the dimmed text is unreadable. Make `mdTodo.dimOpacity` a configuration setting (the date opacity already is; mirror the pattern). *Effort:* S.
3. **No `aria`-style labels on the status bar items.** `text` and `tooltip` only. VS Code's status bar API has limited support, but ensure tooltips read like sentences (they mostly already do). *Effort:* S — mostly already fine.
4. **Tree-view labels rely on icons to distinguish state.** Active uses `list-unordered`, Completed `check-all`, Archive `archive` (`extension.ts:2340`). Screen readers will read just the label, which already includes the section name — good. **Likely fine, mention only.**

---

## 10. Robustness

1. **Timezone mismatch in `getToday()` vs `parseDate()`.** `extension.ts:83` uses UTC (`new Date().toISOString().split('T')[0]`); `extension.ts:87` builds a `Date` from year/month/day in **local** time. A user in `UTC-8` at 11pm gets tomorrow's date inserted into their todo, and the date is then re-parsed in local time and rendered as if it were a real local date — inconsistent. *Why it matters:* off-by-one bugs in stale/archive thresholds, dates that "appear to be in the future." *Effort:* S. *Anchor:* `extension.ts:83, 87, 1685`.
2. **`child_process.exec` with quoted file path.** `extension.ts:806, 840`. Double-quoted shell still expands `$` and backticks. A workspace path with `$USER` or backticks in the directory name would break or be exploitable. Switch to `execFile` with arg array. *Effort:* S. (Also see Code-2.)
3. **Code fences and HTML comments still match `#tag` / `@user`.** `extension.ts:257, 261, 1338, 1433`. A `- [ ] foo \`#bar\`` would get tagged; an `<!-- @alice helped -->` would get mention-decorated. Add a "skip if inside code fence or HTML comment" pass for decorations and for tag/mention extraction. *Why it matters:* false positives in the tree views and dim layer. *Effort:* M. *Anchor:* parser at `extension.ts:219` and decoration loops at `extension.ts:1336, 1388, 1431`.
4. **`markItemDone` two-step edit isn't atomic.** Already noted in Code-9. Stand-alone here as a *robustness* issue: a busy editor that fires another `onDidChangeTextDocument` in between will see the file mid-state. *Effort:* M.
5. **`isTodoFile` only checks the first 20 lines.** `extension.ts:68`. Reasonable, but YAML frontmatter could legitimately exceed 20 lines (e.g. heavy metadata blocks). Either lift the limit or document it. *Effort:* S.
6. **Sectionless files silently misbehave.** `addItem` falls back to "insert after the first `##`-prefixed header, else line 0" (`extension.ts:451–462`); `archiveItems` creates the section if missing (`extension.ts:776`). The fallback paths aren't tested; first-time use on a barely-initialised file can produce a malformed structure. *Effort:* S–M after Test-1 lands.
7. **`parseDocument` doesn't gracefully handle items with `[X]` (uppercase) for the checkbox.** The regex at `extension.ts:246` is `[ xX]`, so uppercase `X` is accepted — good. But the completion-write path uses lowercase `x` (`extension.ts:540`). If a file mixes, you can hit "Item is already complete" inconsistently. *Effort:* S — normalise on write.
8. **`addTags`' "replace all tags" obliterates duplicate-style tag annotations.** `updateItemTags` (`extension.ts:1110`) removes *all* `#tag` tokens and re-appends. If the user has e.g. `#today` written as a non-tag literal earlier in the line, it'll be stripped. *Why it matters:* unexpected data loss. *Effort:* S — anchor tag insertion to the *trailing* contiguous run only.
9. **`assignFocusedUser` preserves nothing when removing.** `extension.ts:2168–2178`: collapses double-spaces. Good. But it doesn't handle the case where the line ends in `@alice` and removing it leaves a trailing space before the backtick-date token. Edge case; verify in tests. *Effort:* S.
10. **`decorationType.dispose()` not called in `deactivate()`.** `extension.ts:3376` is empty. The dispose calls in the `create*DecorationType` functions only fire on re-creation. *Effort:* S. *Anchor:* `extension.ts:3376`.

---

## Deliberately omitted

A few candidates I considered and dropped, with the reason — so you don't waste effort wondering whether I missed them.

1. **Rename `MD Todo` to a punchier brand.** Marketplaces reward distinctive names, but rebrand cost (existing installs, settings keys, marketplace URL) dwarfs the benefit at this stage.
2. **Webview-based dashboard for stats / reports.** The current "open a markdown buffer beside" approach (`extension.ts:1937, 942`) is more git-friendly, more keyboard-driven, and matches the extension's "plain markdown" ethos. A webview would be a regression on those axes for little gain.
3. **A `## Notes` top-level section.** The current under-item note format (`- YYYY-MM-DD: text`) is good. A separate `## Notes` section duplicates and complicates the parser without solving an articulated user need.
4. **Auto-detect "todo-shaped" files without `md-todo: true` frontmatter.** Tempting, but the explicit frontmatter is also the trust boundary — every command and every decoration relies on it. Inferring would mean every `[ ]` in every markdown file becomes a target. Keep the explicit opt-in.
5. **Replace the chord keybinding scheme (`Ctrl+Shift+T <key>`) with single-key shortcuts.** Chords are slightly slower but the scheme avoids stomping on common VS Code defaults (`Ctrl+Shift+A` is "Toggle Comment", `Ctrl+Shift+D` is "Run Without Debugging"). The stale README references in UX-1 are doc bugs, not a keybinding redesign.
