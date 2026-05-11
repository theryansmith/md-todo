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

# Compile TypeScript
npm run compile

# Package as VSIX
npm run package
```

This creates `md-todo-1.0.0.vsix` in the project folder.

### Install the VSIX

In VS Code: Extensions → `...` → **Install from VSIX** → select the `.vsix` file.

### Development Mode

For active development, symlink the extension folder so changes are picked up after reloading without reinstalling.

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

After making changes, compile and reload VS Code:

```bash
npm run compile
```

Then press `Ctrl+Shift+P` → "Developer: Reload Window" (or `Ctrl+R` if DevTools is focused).

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

| Command | Shortcut | Description |
| ------- | -------- | ----------- |
| `MD Todo: Add Item` | `Ctrl+Shift+T T` | Add new item with today's date |
| `MD Todo: Mark Done` | `Ctrl+Shift+T D` | Mark item at cursor (or select from list) as complete |
| `MD Todo: Add Note` | `Ctrl+Shift+T N` | Add dated note to item at cursor (or select) |
| `MD Todo: Add/Edit Tags` | `Ctrl+Shift+T Shift+T` | Add or modify tags on an item |
| `MD Todo: Manage Tags` | - | Add or edit tag definitions |
| `MD Todo: Add User` | - | Define a new user (shortname / full name / description) in the `## Users` section |
| `MD Todo: Archive Completed` | `Ctrl+Shift+T A` | Move old completed items to Archive section |
| `MD Todo: Show Git History` | - | Browse git commits for this file, view diffs |
| `MD Todo: Show Stats` | - | Velocity, avg completion time, oldest items |
| `MD Todo: Show Recently Completed` | - | Pick a date range; opens a side-panel report and dims items outside the range |
| `MD Todo: Show Recently Added` | - | Same as above, but for items added in the range |
| `MD Todo: Show Stale Items` | - | Pick a threshold; opens a report of incomplete items older than N days |
| `MD Todo: Clear Activity Focus` | - | Remove the active date filter |
| `MD Todo: Quick Add` | - | Insert todo template at cursor |
| `MD Todo: Set Tag Focus` | `Ctrl+Shift+T F` | Pick a tag from `## Tags` to focus on; non-matching todos dim in place |
| `MD Todo: Set Focus User` | `Ctrl+Shift+T Shift+F` | Pick a user from `## Users` to focus on; non-mentioning todos dim |
| `MD Todo: Assign Focused User` | `Ctrl+Shift+T Shift+U` | Toggle `@<focusUser>` on the todo at the cursor |

## File Format

Todo files require YAML frontmatter with `md-todo: true`:

```markdown
---
md-todo: true
---

# TODO

## Active

- [ ] Finish tech audit report `+2025-01-20` #work #urgent
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

```

### Frontmatter

The `md-todo: true` frontmatter is required for the extension to activate on a file. This prevents the extension from affecting regular markdown files.

### Date Format

- `+YYYY-MM-DD` — When item was added (ISO 8601)
- `✓YYYY-MM-DD` — When item was completed

Notes are indented with `- YYYY-MM-DD: text` format.

### Tags

- Tags use `#tagname` format (alphanumeric and hyphens)
- Define tags in a `## Tags` section with `**tagname**: description` format
- Tags render in **purple** (`charts.purple`) — clearly distinct from body text but less prominent than `@mentions`. Visual hierarchy: **`@mentions` (bold blue) > `#tags` (purple) > normal text**
- Use **Tag Focus** (status bar / `Ctrl+Shift+T F`) to dim every todo whose subtree does not contain the chosen tag — the active editor stays in place, no extra tab is opened

#### Tag completion

Type `#` mid-sentence in a todo file and a completion list appears with every tag defined in `## Tags`. Each row shows the tag name plus its description, and the fuzzy matcher searches across both the name and the description — typing part of a description narrows the list just like typing the tag name. The selection is inserted inline at the cursor (with a trailing space if the next character isn't whitespace).

#### Tag Focus (status bar)

A second status bar item on the bottom-right shows the current tag focus, parallel to the user-focus item:

- Default: `$(tag) All tags` — nothing dimmed by tag.
- After picking a tag: `$(tag) #work` — every top-level todo whose subtree does NOT contain `#work` is rendered at 25% opacity. Matched items (and any of their ancestors that share the subtree) stay fully visible.

Click the status bar item, run `MD Todo: Set Tag Focus`, or press `Ctrl+Shift+T F` to set or clear focus. Focus is persisted per-workspace.

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

## Workflow

### Daily

1. Open your todo.md
2. `Ctrl+Shift+A` to add new items
3. `Ctrl+Shift+D` when you complete something
4. `Ctrl+Shift+N` to log progress notes
5. Commit to git

### Weekly

1. `Todo: Show Stats` to review velocity
2. `Todo: Archive Completed` to clean up old items

### History Review

Use `Todo: Show Git History` to see exactly when items were added, completed, or modified. Since the file doesn't duplicate daily, diffs are clean and meaningful.

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

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for the full list of user-facing changes per release.

## ToDO

- [ ] consider making the tags and users inline autocompletion work in any type of doc, not just md.  The last selected mdtodo doc should be the source.
- [ ] alphabetical sorting of tags and users works in the mdtodo panels, but not in the command pallet
- [ ] consider ways in markdown renderers to give the tags and dates a separate text color/font/highlight/etc so they stand out more in the rendered md view (i.e. with vscode preview, or on github, etc)
