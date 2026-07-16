# MD Todo

A VS Code extension for managing markdown todo lists with automatic date tracking, notes, tags, archiving, and git-friendly history.

> **Note on authorship**
> This project — including the extension code, configuration, CI/CD, and documentation — was generated entirely by [Claude Code](https://claude.com/claude-code). I did not write any of it by hand. I directed Claude with prompts; Claude produced the implementation. I am the prompter, not the author. Treat all design and code decisions as Claude's, not mine.

## Installation

### From the Marketplace

Search for **MD Todo** in the VS Code Extensions panel, or install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=theryansmith.md-todo).

### From VSIX

1. Download the `.vsix` from [Releases](https://github.com/theryansmith/md-todo/releases)
2. In VS Code: Extensions → `...` → Install from VSIX

### From Source

See [Building](#building) below.

## Building

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- npm (comes with Node.js)

### Build Steps

```bash
# Clone the repository
git clone https://github.com/theryansmith/md-todo.git
cd md-todo

# Install dependencies
npm install

# Bundle the extension (esbuild -> dist/extension.js)
npm run build

# Package as VSIX
npm run package
```

Sources live under `src/` and are bundled by [esbuild](https://esbuild.github.io/) into a single `dist/extension.js` (the extension entry point). `npm run build` produces the minified production bundle; `npm run build:dev` builds unminified and `npm run watch` rebuilds on change. Typechecking is a separate step (`npm run typecheck` — esbuild does not typecheck), and `npm run verify` runs every CI gate locally (typecheck, lint, format check, markdownlint, tests with coverage thresholds). Packaging creates `md-todo-<version>.vsix` in the project folder.

### Install the VSIX

In VS Code: Extensions → `...` → **Install from VSIX** → select the `.vsix` file.

### Development Mode

For active development, symlink the extension folder so changes are picked up after reloading without reinstalling. The extension loads from the bundled `dist/extension.js` (`main` in `package.json`), so run a build at least once before reloading — the symlinked folder must contain `dist/`.

**Windows (requires Administrator):**

Open an elevated PowerShell and run:

```powershell
# Remove existing installation if present
Remove-Item "$env:USERPROFILE\.vscode\extensions\md-todo" -Recurse -Force

# Create symlink to source
New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.vscode\extensions\md-todo" -Target "F:\src\md-todo"
```

**macOS/Linux:**

```bash
rm -rf ~/.vscode/extensions/md-todo
ln -s /path/to/md-todo ~/.vscode/extensions/md-todo
```

After making changes, rebuild the bundle and reload VS Code:

```bash
npm run build:dev
```

(or leave `npm run watch` running to rebuild on every save). Then press `Ctrl+Shift+P` → "Developer: Reload Window" (or `Ctrl+R` if DevTools is focused).

**Switching back to released version:**

To remove the dev symlink and use the installed VSIX instead:

```powershell
# Windows (elevated PowerShell)
Remove-Item "$env:USERPROFILE\.vscode\extensions\md-todo" -Force
```

```bash
# macOS/Linux
rm ~/.vscode/extensions/md-todo
```

Then reinstall via Extensions → `...` → **Install from VSIX**, and reload VS Code.

### Creating a Release

Releases are built and published by GitHub Actions on tag push. The tag is the source of truth for the version — CI rewrites `package.json` from the tag name, so you don't need to bump it manually beforehand.

1. **Create and push a tag** matching `v<semver>`:

   ```bash
   git tag v1.2.1
   git push origin v1.2.1
   ```

The `release` workflow will automatically:

- Set `package.json` version from the tag (`v1.2.1` → `1.2.1`)
- Build the VSIX
- Publish to the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=theryansmith.md-todo) (requires the `VSCE_PAT` repo secret)
- Create a GitHub Release with the VSIX attached and auto-generated notes

Users can install from the marketplace or download the VSIX asset from <https://github.com/theryansmith/md-todo/releases>.

## Commands

All commands work on todo files (markdown with `md-todo: true` frontmatter). Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                                        | Shortcut               | Description                                                                                                                                                                  |
| ---------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MD Todo: Add Todo Item`                       | `Ctrl+Shift+T T`       | Add new item with today's date                                                                                                                                               |
| `MD Todo: Mark Done`                           | `Ctrl+Shift+T D`       | Mark item at cursor (or select from list) as complete                                                                                                                        |
| `MD Todo: Add Note`                            | `Ctrl+Shift+T N`       | Add dated note to item at cursor (or select)                                                                                                                                 |
| `MD Todo: Add/Edit Tags`                       | `Ctrl+Shift+T Shift+T` | Add or modify tags on an item                                                                                                                                                |
| `MD Todo: Manage Tag Definitions`              | -                      | Add or edit tag definitions in `## Tags`                                                                                                                                     |
| `MD Todo: Set Project`                         | `Ctrl+Shift+T P`       | Set (or remove) the single `[project]` on an item                                                                                                                            |
| `MD Todo: Manage Project Definitions`          | -                      | Add or edit project definitions in `## Projects`                                                                                                                             |
| `MD Todo: Show Project View`                   | -                      | Pick a project; opens a read-only report of every item in it, complete or not, with hierarchy                                                                                |
| `MD Todo: Add User`                            | -                      | Define a new user (shortname / full name / description) in the `## Users` section                                                                                            |
| `MD Todo: Archive Completed Items`             | `Ctrl+Shift+T A`       | Move old completed items to Archive section                                                                                                                                  |
| `MD Todo: Show Git History`                    | -                      | Browse git commits for this file, view diffs                                                                                                                                 |
| `MD Todo: Show Stats`                          | -                      | Velocity, avg completion time, oldest items                                                                                                                                  |
| `MD Todo: Show Recently Completed`             | -                      | Pick a date range; opens a side-panel report and dims items outside the range. Each completed item that has a parent todo also shows the parent's text and notes for context |
| `MD Todo: Show Recently Added`                 | -                      | Same as above, but for items added in the range                                                                                                                              |
| `MD Todo: Show Stale Items`                    | -                      | Pick a threshold; opens a report of incomplete items older than N days                                                                                                       |
| `MD Todo: Clear Activity Focus`                | -                      | Remove the active date filter                                                                                                                                                |
| `MD Todo: Quick Add at Cursor`                 | -                      | Insert todo template at cursor                                                                                                                                               |
| `MD Todo: Initialize Todo File`                | -                      | Insert the starter template (frontmatter + sections) into the current markdown file                                                                                          |
| `MD Todo: Set Focus Tag`                       | `Ctrl+Shift+T F`       | Pick a tag from `## Tags` to focus on; non-matching todos dim in place                                                                                                       |
| `MD Todo: Set Focus User`                      | `Ctrl+Shift+T Shift+F` | Pick a user from `## Users` to focus on; non-mentioning todos dim                                                                                                            |
| `MD Todo: Set Focus Project`                   | `Ctrl+Shift+T Shift+P` | Pick a project from `## Projects` to focus on; todos outside the project dim                                                                                                 |
| `MD Todo: Set Focus Activity`                  | -                      | Open the activity-focus picker (same as clicking the status-bar `$(calendar)` item)                                                                                          |
| `MD Todo: Clear All Focus`                     | -                      | Clear tag focus, user focus, project focus, and activity focus in one shot                                                                                                   |
| `MD Todo: Assign Focused User to Current Todo` | `Ctrl+Shift+T Shift+U` | Toggle `@<focusUser>` on the todo at the cursor                                                                                                                              |

The tree views' right-click actions (Mark Done, Reassign User, Edit Tags, Set Project, Focus on User/Tag/Project, Clear User/Tag/Project Focus, Show Project View) are documented with their tree views below.

The tag and user picker lists shown by these commands — `Add/Edit Tags`, `Manage Tags`, `Set Focus Tag`, `Set Focus User`, and `Assign Focused User` — are sorted alphabetically (case-insensitive), matching the order used in the **MD TODO TAGS** and **MD TODO USERS** panels. The inline `@` / `#` autocomplete dropdown that appears while typing in the `Add Todo Item` input is sorted the same way, regardless of where the `@` / `#` appears in the input — including when it is the very first character typed.

## File Format

Todo files require YAML frontmatter with `md-todo: true`:

```markdown
---
md-todo: true
---

# TODO

## Active

- [ ] Finish tech audit report `+2025-01-20` #work #urgent `[game-x]`
  - 2025-01-22: Got rendering section drafted
  - 2025-01-25: Waiting on build metrics from infra team
- [ ] 1:1 prep for new hires `+2025-01-26` #work @jdoe
- [x] Review Lumen perf docs `+2025-01-15` `✓2025-01-24` #reading

## Completed

- [x] Set up FASTBuild on dev machine `+2025-01-10` `✓2025-01-12` #work
- [x] Draft intro message for team `+2025-01-08` `✓2025-01-09` #work

## Archive

<!-- Old completed items get moved here automatically -->


## Tags

**work**: Work-related tasks and projects
**reading**: Documentation and learning materials
**urgent**: High priority, needs immediate attention

## Users

**jdoe** (John Doe): team member, new hire
**asmith** (Alice Smith): frontend lead

## Projects

**game-x**: The big unannounced title
**tools**: Internal tooling and infrastructure

```

### Frontmatter

The `md-todo: true` frontmatter is required for the extension to activate on a file. This prevents the extension from affecting regular markdown files.

### Date Format

- `+YYYY-MM-DD` — When item was added (ISO 8601)
- `✓YYYY-MM-DD` — When item was completed

Notes are indented with `- YYYY-MM-DD: text` format.

Dates are always derived from your **local** clock (the same "today" the rest of your desktop shows), not UTC.

#### Automatic date on Enter

You don't have to type the added-date yourself. When you press Enter at the end of a manually typed todo line (`- [ ] some task`) or an indented note line that doesn't already carry a `` `+date` `` token, the extension appends today's `` `+YYYY-MM-DD` `` to the line you just finished. This only happens in todo files (files with the `md-todo: true` frontmatter), only on lines with actual text, and the stamp joins your typing as a single undo step. There is currently no setting to disable it.

### Tags

- Tags use `#tagname` format (alphanumeric and hyphens)
- Define tags in a `## Tags` section with `**tagname**: description` format
- Tags render in **purple** (`charts.purple`) — clearly distinct from body text but less prominent than `@mentions`. Visual hierarchy: **`@mentions` (bold blue) > `#tags` (purple) > normal text**
- Use **Tag Focus** (status bar / `Ctrl+Shift+T F`) to dim every todo whose subtree does not contain the chosen tag — the active editor stays in place, no extra tab is opened

#### Tag completion

Type `#` mid-sentence in a todo file and a completion list appears with every tag defined in `## Tags`. Each row shows the tag name plus its description, and the fuzzy matcher searches across both the name and the description — typing part of a description narrows the list just like typing the tag name. The selection is inserted inline at the cursor (with a trailing space if the next character isn't whitespace).

#### Inline completion in any document

Both `#tag` and `@user` autocompletion now fire in **any** open document — `.txt`, `.py`, code comments, plain markdown without `md-todo: true`, anywhere. Type `#` or `@` and the same completion list appears. Completions are sourced from the most recently focused mdtodo doc, so the tags and users you use in todos stay one keystroke away wherever you're typing.

#### Tag Focus (status bar)

A second status bar item on the bottom-right shows the current tag focus, parallel to the user-focus item:

- Default: `$(tag) All tags` — nothing dimmed by tag.
- After picking a tag: `$(tag) #work` — every top-level todo whose subtree does NOT contain `#work` is rendered at 25% opacity. Matched items (and any of their ancestors that share the subtree) stay fully visible.

Click the status bar item, run `MD Todo: Set Focus Tag`, or press `Ctrl+Shift+T F` to set or clear focus. Focus is persisted per-workspace.

When **both** Tag Focus and User Focus are set, the dim filter applies AND semantics — a top-level item stays visible only if some node in its subtree mentions the focused user AND carries the focused tag. Either filter alone behaves as before.

#### Tree View — MD TODO TAGS

Parallel to the users tree, the **MD TODO** container on the Activity Bar (left rail) hosts an **MD TODO TAGS** view that lists every tag defined in the active todo file's `## Tags` section, plus an **Untagged** bucket for items with no `#tag`. Each tag expands to `Active`, `Completed`, and `Archive` groupings of the todos that carry it; each grouping expands to the individual todos.

- **Click a todo leaf** — opens the source document and jumps the cursor to that line.
- **Right-click a tag → Focus on Tag in Editor** — sets tag focus to that tag *in place* (no new tab). The status bar updates to `$(tag) #tagname` and dimming applies as described above.
- **Right-click a tag → Clear Tag Focus** — clears any active tag focus (also available as `MD Todo: Clear Tag Focus` in the command palette).
- **Right-click a todo → Mark Done** — marks the todo complete from the tree.
- **Right-click a todo → Edit Tags** — opens the source document, places the cursor on the line, and runs `MD Todo: Add/Edit Tags` so you can change the tag set.

The tree tracks the most recently active todo file via workspace state (with its own key, distinct from the users tree), so it stays populated while you switch to non-todo editors.

#### Per-span dim

When a focus user, focus tag, or both are set, dimming now applies in **two layers**:

1. **Subtree-level**: every top-level todo whose subtree does not match is rendered at 25% opacity (full lines, including descendants).
2. **Span-level**: across the entire document — including inside still-visible matching items — every non-focused `@mention` span (when a focus user is set) and every non-focused `#tag` span (when a focus tag is set) is also dimmed to 25%. The focused span itself stays at full opacity, so the eye lands on it immediately.

### Projects

Group tasks by project with a backtick-wrapped bracket token:

```markdown
- [ ] Ship rework `+2026-07-10` `[game-x]` #work @jdoe
```

- Project tokens use `` `[project-name]` `` format (alphanumeric, underscores, and hyphens). The backticks are required — plain `[brackets]`, markdown links `[text](url)`, reference links, and footnotes are never treated as projects.
- **Single project per task**: the first token on the line wins. `MD Todo: Set Project` (`Ctrl+Shift+T P`) strips every project token from the line and appends exactly one at the end (or none, to remove the project). The picker offers every defined project plus a `Create new project…` entry.
- **Inheritance**: children inherit the nearest ancestor's project unless they carry their own token — tag a top-level item once and its whole subtree belongs to that project.
- Define projects in a `## Projects` section with `**project-name**: description` format (`MD Todo: Manage Project Definitions` adds or edits them, auto-creating the section at the end of the document when missing).
- Project tokens render in **orange** (`charts.orange`) — distinct from `#tags` (purple) and `@mentions` (bold blue).
- Type `[` in any document and a completion list appears with every defined project, sourced from the most recently focused mdtodo doc — same behavior as the `#` and `@` completions. The typed `[` (and the editor's auto-closed `]`, if any) is replaced by the full `` `[name]` `` token. The inline dropdown in `Add Todo Item` also suggests projects when you type `[`.

#### Project Focus (status bar)

A fourth status bar item shows the current project focus:

- Default: `$(project) All projects` — nothing dimmed by project.
- After picking a project: `$(project) [game-x]` — every top-level todo whose subtree does not belong to `[game-x]` (own token or inherited) is rendered at 25% opacity, and non-focused project-token spans dim across the document.

Click the status bar item, run `MD Todo: Set Focus Project`, or press `Ctrl+Shift+T Shift+P` to set or clear focus. Focus is persisted per-workspace and AND-composes with tag, user, and activity focus.

#### Project View

`MD Todo: Show Project View` opens a read-only report (an untitled markdown document beside the editor, same mechanism as `Show Recently Completed`) listing every item that belongs to a chosen project — active, completed, and archived alike — grouped under `## Active` / `## Completed` / `## Archive` headings. Within each heading, items keep the parent/child hierarchy they have in the source document: a matching task's whole subtree renders nested underneath it, notes included. If a matching task is nested under a parent that belongs to a *different* project (or no project at all), that parent is still shown — marked `_(context)_` — so the task's place in the document stays legible. Nothing in this view edits or syncs back to the source file.

#### Tree View — MD TODO PROJECTS

Parallel to the tags tree, the **MD TODO** container hosts an **MD TODO PROJECTS** view listing every project defined in the active todo file's `## Projects` section, plus a **No Project** bucket for items with no own or inherited project. Each project expands to `Active`, `Completed`, and `Archive` groupings; each grouping expands to the individual todos (membership follows inheritance, so children of a `[game-x]` item appear under `game-x`). Tokens naming projects that are not defined in `## Projects` still get a root — shown with a warning icon — so those tasks stay reachable; add the definition via `MD Todo: Manage Project Definitions` to make it official.

- **Click a todo leaf** — opens the source document and jumps the cursor to that line.
- **Right-click a project → Focus on Project in Editor** — sets project focus to that project in place.
- **Right-click a project → Clear Project Focus** — clears any active project focus.
- **Right-click a project → Show Project View** — opens the same read-only hierarchy report described above for that project.
- **Right-click a todo → Mark Done** — marks the todo complete from the tree.
- **Right-click a todo → Set Project** — opens the source document, places the cursor on the line, and runs `MD Todo: Set Project`.

### Users and `@mentions`

People are first-class. Define them in a `## Users` section parallel to `## Tags`:

```markdown
## Users

**jdoe** (John Doe): backend, new hire
**asmith** (Alice Smith): frontend lead
**bkim** (Brian Kim): infra & tools
```

Format: `**shortname** (Full Name): description`. The `(Full Name)` part is optional.

Reference users in todos with `@shortname`:

```markdown
- [ ] Pair on the dashboard layout `+2026-01-29` @asmith #work
```

`@mentions` are extracted independently of `#tags`; an item can have both. Mentions render bold with an accent color.

#### Hover and completion

- Hover over `@jdoe` in the editor to see the user's full name and description.
- Type `@` in a todo file and a completion list appears with all defined users. Each row shows the shortname plus the full name and description, and the fuzzy matcher searches across all three fields — typing part of a fullname or description narrows the list just like typing the shortname.

#### Tree View — MD TODO USERS

The **MD TODO** container on the Activity Bar (left rail) hosts an **MD TODO USERS** view that lists every user defined in the active todo file's `## Users` section, plus an **Unassigned** bucket. Each user expands to `Active`, `Completed`, and `Archive` groupings of the todos that mention them; each grouping expands to the individual todos.

The MD TODO container can be relocated like any VS Code view — drag the container's icon out of the Activity Bar into the bottom panel or secondary sidebar, and the panel header will read "MD TODO" (not "Explorer").

- **Click a todo leaf** — opens the source document and jumps the cursor to that line.
- **Right-click a user → Focus on User in Editor** — sets focus mode to that user *in place* (no new tab). The status bar updates to `$(person) @shortname` and every top-level todo whose subtree does NOT mention the focused user is dimmed to 25% opacity.
- **Right-click a user → Clear User Focus** — clears any active user focus (also available as `MD Todo: Clear User Focus` in the command palette, or by clicking the status bar item).
- **Right-click a todo → Reassign User** — pick a different user; the first `@mention` on the line is replaced (or appended if there was none).
- **Right-click a todo → Mark Done** — marks the todo complete from the tree (no need to navigate to the line first).

The tree tracks the most recently active todo file via workspace state, so it stays populated while you switch to non-todo editors (or to the tree itself).

#### Focus mode (status bar)

A status bar item on the bottom-right shows the current user focus:

- Default: `$(person) All users` — nothing dimmed.
- After picking a user: `$(person) @jdoe` — every top-level todo whose subtree does NOT mention `@jdoe` is rendered at 25% opacity. The matched items (and their parent context) stay fully visible.

Click the status bar item, run `MD Todo: Set Focus User`, or press `Ctrl+Shift+T Shift+F` to set or clear focus. Focus is persisted per-workspace. When combined with Tag Focus, both filters must match (AND).

#### Quick assign chord

`Ctrl+Shift+T Shift+U` (`Cmd+Shift+T Shift+U` on macOS) toggles `@<focusUser>` on the todo line at the cursor:

- If a focus user is set, the chord toggles that user without prompting.
- If no focus is set, a quick pick of all defined users appears.
- If the line already contains `@<shortname>`, the mention is removed (and any double-spaces are collapsed).
- Otherwise, the mention is inserted at the cursor with surrounding whitespace as needed.

## Configuration

In VS Code settings:

```json
{
  "mdTodo.archiveAfterDays": 7,
  "mdTodo.dateOpacity": 0.5,
  "mdTodo.staleAfterDays": 30
}
```

- `archiveAfterDays`: Days after completion before items can be archived (default: 7)
- `dateOpacity`: Visual opacity for date decorations like `+2026-01-28` and `✓2026-01-28`, 0.1-1.0 (default: 0.5)
- `staleAfterDays`: Default "older than" threshold in days for `MD Todo: Show Stale Items` (default: 30). The picker still lets you choose a different value at run time.

## Limitations / Known Behaviors

- **One todo file at a time.** The tree views, status-bar focus items, and inline completions all follow the *most recently focused* todo file. You can keep several todo files, but the extension's views reflect one of them at a time — there is no cross-file aggregation.
- **Code fences and HTML comments are ignored.** Lines inside fenced code blocks (backtick or tilde fences) and HTML comment blocks (`<!-- -->`) are excluded from parsing and decoration — a `- [ ] example` inside a code sample is not a real todo, and `#tags` / `@mentions` / dates inside fences or comments are neither highlighted nor counted. Inline code spans on normal lines (a `#tag` between single backticks) are still matched. *New in this release* — previously fence/comment content produced false positives in the trees, reports, and highlighting.
- **Frontmatter is scanned within the first 20 lines.** The `md-todo: true` opt-in must appear inside a `---` frontmatter block whose closing `---` falls within the first 20 lines of the file. Very large frontmatter blocks won't be recognized.
- **Dates use local time.** All dates written and compared (`+added`, `✓completed`, staleness, activity ranges) use your machine's local clock. Collaborators in different timezones may stamp different calendar dates for the same instant — expected for a plain-text format, but worth knowing.

## Workflow

### Daily

1. Open your todo.md
2. `Ctrl+Shift+T T` to add new items
3. `Ctrl+Shift+T D` when you complete something
4. `Ctrl+Shift+T N` to log progress notes
5. Commit to git

All shortcuts are two-step chords: press `Ctrl+Shift+T` (`Cmd+Shift+T` on macOS), release, then press the second key.

### Weekly

1. `MD Todo: Show Stats` to review velocity
2. `MD Todo: Archive Completed Items` to clean up old items

### History Review

Use `MD Todo: Show Git History` to see exactly when items were added, completed, or modified. Since the file doesn't duplicate daily, diffs are clean and meaningful.

## Why This Approach?

**vs. Daily copy-paste method:**

- ✅ No file bloat from repetition
- ✅ Clean git diffs showing actual changes
- ✅ Easy to see item age at a glance
- ✅ Notes stay attached to items
- ✅ Automated timestamps reduce friction

**vs. Full todo apps:**

- ✅ Plain markdown, works anywhere
- ✅ Git-native history
- ✅ No sync/vendor lock-in
- ✅ Keyboard-driven workflow

## Architecture

The source under `src/` is layered, with the dependency direction enforced by ESLint (violations fail CI):

- `src/core/` — pure domain logic (parsing, dates, tokens, edit plans, queries). Imports **no** VS Code API; unit-tested without any editor mock.
- `src/vscode/` — host adapters: generic engines for trees, decorations, focus dimensions, plus guards, the parse cache, and the atomic edit executor.
- `src/features/` — one folder per user-facing capability, composing `core/` and `vscode/`.
- `src/registrations/` + `src/extension.ts` — the single composition root: command table, views, event wiring.

The design rationale, migration history, and decision log live in [Docs/tdd/enterprise-restructure.md](Docs/tdd/enterprise-restructure.md).

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full list of user-facing changes per release.

## ToDO

Shipped items are removed from this list and described in [CHANGELOG.md](CHANGELOG.md). The feature backlog beyond this list lives in [IMPROVEMENTS.md](IMPROVEMENTS.md); new work starts with a TDD under `Docs/tdd/`.

- [ ] consider ways in markdown renderers to give the tags and dates a separate text color/font/highlight/etc so they stand out more in the rendered md view (i.e. with vscode preview, or on github, etc)
