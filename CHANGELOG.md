# Changelog

All notable user-facing changes to MD Todo are documented here. Newest first. When an item from the README's `## ToDO` ships, it's deleted from that list and described here in user-facing language.

## [Unreleased]

- Projects: group tasks by project with a backtick-wrapped bracket token — `` `[game-x]` `` — on the todo line. Backticks are required, so markdown links, footnotes, and the `- [ ]` checkbox are never mistaken for projects. One project per task: the first token on a line wins.
- Inheritance: child todos belong to the nearest ancestor's project unless they carry their own token, so tagging a top-level item covers its whole subtree.
- Define projects in a new `## Projects` section (`**project-name**: description`), parallel to `## Tags` and `## Users`. The `Initialize Todo File` template now includes the section.
- New **MD TODO PROJECTS** tree view in the MD TODO container: every defined project plus a **No Project** bucket, each expanding to Active / Completed / Archive groupings. Right-click actions: Focus on Project in Editor, Clear Project Focus, Mark Done, Set Project.
- New commands: `MD Todo: Set Project` (`Ctrl+Shift+T P`) sets, changes, or removes the project on the item at the cursor (with a `Create new project…` path), and `MD Todo: Manage Project Definitions` adds or edits entries in `## Projects`.
- Project focus is a fourth focus dimension: `MD Todo: Set Focus Project` (`Ctrl+Shift+T Shift+P`, or click the new `$(project)` status bar item) dims every todo outside the chosen project, AND-composed with user, tag, and activity focus. `Clear All Focus` now clears it too.
- Typing `[` in any document autocompletes defined projects (like `#` and `@`), and project tokens render in orange (`charts.orange`) in the editor.
- Internal: first automated test suite (Vitest) covering the token grammar, parser extraction, project inheritance, and the line-rewrite transforms; runs in CI on every push and pull request.

## [1.4.5] — 2026-05-19

- Focus commands: a small cleanup that adds two new commands, renames one display title, and reorders the activity-focus picker for consistency.
  - New command `MD Todo: Clear All Focus` clears user, tag, and activity focus in one step.
  - New command `MD Todo: Set Focus Activity` opens the same picker as clicking the activity item in the status bar.
  - Renamed display title `Set Tag Focus` → `Set Focus Tag`. The underlying command ID was already `mdTodo.setFocusTag` (renamed in the v1.4.3 refactor), so custom keybindings are unaffected.
  - The Activity Focus picker now shows `Clear Activity Focus` at the top of the list, matching the User and Tag focus pickers.

## [1.4.4] — 2026-05-19

- Performance: significantly reduces the work done on every keystroke in mdtodo documents. Highlights:
  - Parse cache: `parseDocument` is now memoized by `(uri, version)`, eliminating the 3–6 redundant re-parses per keystroke that previously occurred across decoration updaters, tree views, completion providers, and the status bar.
  - Whitespace-only edit skip: decoration and tree refreshes short-circuit when a change adds only whitespace.
  - Incremental decorations: tag, date, and mention decoration sets are now updated incrementally on edits — only the touched line range is re-scanned; decorations below the edit shift by the line delta. Dim decorations short-circuit when no focus is set; with focus active they still full-scan to preserve subtree correctness.
  - The dropdown completions, tree views, and status-bar focus indicator all benefit transparently from the parse cache.

## [1.4.3] — 2026-05-19

- Internal: refactored `extension.ts` from a single 3,376-line file into ~30 focused modules (types, parser, dates, state, per-decoration files, per-tree-view files, per-command files, completions, prompts, focus subsystems). No user-visible change; same behavior, dramatically smaller cognitive surface for future work.

## [1.4.2] — 2026-05-18

- Fix: the `@` and `#` autocomplete in the Add Todo Item input is now correctly alphabetized when the trigger character is the very first thing typed. v1.4.1 sorted the items we hand to VS Code, but VS Code's QuickPick view re-scored and reordered them by its internal label matcher — disabling that with the (undocumented) `matchOnLabel = false` and `sortByLabel = false` properties makes our insertion order authoritative.

## [1.4.1] — 2026-05-18

- Bug-fix follow-up to v1.4.0: the inline `@` / `#` autocomplete dropdown in `Add Todo Item` now sorts entries alphabetically even when `@` or `#` is the very first character typed. v1.4.0's sort was being silently re-ordered by the QuickPick's own fuzzy-match scoring against item descriptions and details; that secondary matching is now disabled (the dropdown still filters by shortname / fullname / description, just via our own substring filter).

## [1.4.0] — 2026-05-18

- The inline `@` / `#` autocomplete dropdown that appears while typing in the `Add Todo Item` input now sorts entries case-insensitively alphabetically, matching the other command-palette pickers and the MD TODO USERS / MD TODO TAGS tree views. Previously this dropdown iterated definitions in source-file order.

## [1.3.0] — 2026-05-18

- Inline `@user` and `#tag` autocomplete now works in any document type, not just markdown. Open a `.txt`, `.py`, source file, or any other doc and the same completions appear — sourced from the most recently focused mdtodo document, so your team's users and tags are available everywhere you take notes.
- Command-palette tag and user pickers now sort their entries case-insensitively, matching the MD TODO USERS and MD TODO TAGS tree views. This affects the `Add Tags`, `Manage Tag Definitions`, `Set Focus User`, `Set Focus Tag`, and `Assign Focused User` flows — previously these iterated definitions in source-file order, which could feel arbitrary on long lists. Header items like `Clear focus` and `Add new tag` stay pinned at the top.

## [1.2.2] — 2026-05-10

- Internal housekeeping release. No user-facing functional changes. CI workflows now run on Node 24-native action versions; TypeScript and markdown lint configuration tightened; minor cosmetic fixes to the README (blank lines around code fences, table-separator padding) and a typo in the bundled `example-todo.md`. The view-icon property on the MD TODO USERS and MD TODO TAGS tree views is now declared explicitly to satisfy the extension manifest schema, but the rendered icon is unchanged — the activity-bar container icon was already being used as a fallback.

## [1.2.1] — 2026-05-10

- Internal release — no user-facing changes. The project moved to a new public home on GitHub and the marketplace listing is now published from the new pipeline.

## [1.2.0] — 2026-05-10

- Three new commands let you slice your todos by date and see a focused report: `MD Todo: Show Recently Completed`, `MD Todo: Show Recently Added`, and `MD Todo: Show Stale Items`. Each first shows a preset picker (Today / Yesterday / Last 7 days / Last 30 days / This week / This month / Last month / Custom…). The Custom option accepts free-form input like `last 2 weeks`, `2026-04-01 to 2026-05-01`, `today`, or `yesterday`. After picking, a side-panel markdown report opens listing the matching items — grouped by date for the date-range commands, sorted oldest-first for stale.
- Activity focus is also a third focus dimension on the editor. Items not in the chosen range dim to 25% opacity, AND-composed with the existing user-focus and tag-focus filters — so you can answer "which items did `@alice` complete with `#work` last week?" by setting all three.
- New `📅` status bar item appears to the right of the user/tag focus items, showing the active activity focus (or `All time`). Click to open a quick menu with the three set commands plus `Clear Activity Focus`.
- New `MD Todo: Clear Activity Focus` command removes the date filter.
- New config setting `mdTodo.staleAfterDays` (default `30`) — the value highlighted as "(default from settings)" in the Show Stale Items picker.

## [1.1.5] — 2026-05-10

- New `MD Todo: Add User` command in the command palette. Prompts for shortname, optional full name, and description, then inserts a new entry under `## Users` — auto-creating the section at the end of the document if it doesn't exist. Mirrors the existing `Manage Tag Definitions` flow. Validates that the shortname is unique and uses only letters, digits, `_`, or `-`.
- The MD TODO USERS and MD TODO TAGS tree views now sort entries alphabetically by their visible label (`@shortname` for users, tag name for tags), regardless of the order they appear in the source file. The `Unassigned` and `Untagged` buckets stay pinned at the bottom of their trees.

## [1.1.4] — 2026-05-10

- The MD TODO USERS and MD TODO TAGS tree views now show the full todo text on each leaf, including `@user` mentions and `#tag` tokens. Previously these were stripped out, hiding cross-references at a glance — a todo under `@alice` that also mentioned `@bob #urgent` looked like a plain task. Dates still surface on the right side as before (`added YYYY-MM-DD` / `done YYYY-MM-DD`). The same change also makes the `MD Todo: Mark Done` and other todo selection prompts searchable by mention or tag.

## [1.1.3] — 2026-05-10

- The `MD Todo: Add Item` and `MD Todo: Add Note` command-palette prompts now offer the same `@user` / `#tag` autocomplete as the editor. Type `@xxx` or `#xxx` mid-input and matching users / tags from the document's `## Users` and `## Tags` sections appear. Press Enter on a highlighted suggestion to insert it (the picker stays open so you can keep typing); press Enter without a highlighted suggestion to submit the task / note.

## [1.1.2] — 2026-05-10

- The MD TODO Users and Tags trees now live in their own dedicated container on the Activity Bar (left rail) instead of inside the Explorer. Drag the container anywhere — the panel header reads "MD TODO" in any dock location.
- Branded extension icon (purple square with bold white check) appears in the Extensions list and on the VS Code Marketplace.

## [1.1.1] — 2026-05-08

- The `Set Focus User` and `Set Tag Focus` pickers now fuzzy-match against full names and descriptions, not just the short name — same behavior as the inline `@` / `#` autocomplete. The `Assign Focused User` and tree-view "Reassign User" pickers got the same fix.

## [1.1.0] — 2026-05-06

- New first-class `## Users` section: define users as `**shortname** (Full Name): description`, reference them in todos with `@shortname`. Hover for full name + description; type `@` for fuzzy completion across all three fields.
- New `## Tags` section parallel to Users: define tags as `**tagname**: description`, reference with `#tag`, autocomplete, hover.
- Focus modes: pick a user or tag from the status bar; non-matching todos dim to 25% opacity. Both can be active simultaneously (AND semantics). Per-span dim also applies inside still-visible items.
- Tree views in the Explorer sidebar — one for users, one for tags — with per-user/per-tag groupings of Active / Completed / Archive todos. Right-click for focus, mark done, edit tags, reassign user. (These trees moved into a dedicated MD TODO container in v1.1.2.)
- Keyboard chord `Ctrl+Shift+T Shift+U` toggles the current focus user's `@mention` on the todo at the cursor.

## [1.0.x] — earlier

Earlier patch releases established the core feature set: filter view, archiving with the `archiveAfterDays` configuration, automatic Completed-section movement (with newest-first sort), nested todos, configurable date opacity, automatic date insertion when typing a new todo or note manually, multi-select tag editor, the `Ctrl+Shift+T <key>` keybinding chord, the `## Tags` section relocated below Archive, and various filter-view bug fixes. The release pipeline also began producing version-stamped VSIX files (v1.0.4).
