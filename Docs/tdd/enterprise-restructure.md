# TDD — Enterprise Restructure of MD Todo

|              |                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------- |
| **Author**   | Ryan Smith (drafted by Claude Code)                                                       |
| **Date**     | 2026-07-15                                                                                |
| **Status**   | Complete (implementation); pending human smoke-test + PR review                           |
| **Tracking** | GitHub PRs referenced per phase in the [Migration Status](#migration-status-living) table |
| **Reviewer** | TBD                                                                                       |
| **Baseline** | `2a4784d` (v1.6.0, `main`)                                                                |

> **This is a living document.** It is the single source of truth for the
> restructure: the [Migration Status](#migration-status-living) table always
> reflects the exact state of the migration, and every PR that advances (or
> changes) the plan must update this file in the same PR. See
> [Living Document Protocol](#living-document-protocol).
>
> **Migration complete (2026-07-15).** All phases are `Done`; final metrics
> are recorded in [Outcome](#outcome-final-metrics-2026-07-15). Per the
> protocol, this document now stands as the architectural record. Remaining
> before release: manual activation smoke on Windows + Linux from the built
> VSIX, and PR review.

---

## Problem

MD Todo has grown from a single 3,376-line `extension.ts` (v1.4.2) into 38
TypeScript modules — but those modules live **flat in the repository root**,
use filename prefixes (`commands-*`, `decoration-*`, `tree-*`, `focus-*`) as
pseudo-directories, and were produced by mechanical extraction rather than
architectural design. The result is heavy copy-paste symmetry (three
near-identical tree providers, five near-identical decoration modules, four
near-identical focus/status-bar modules), no enforced layering (any module may
import `vscode` and any other module), and no tooling guardrails (no linter,
no formatter check, no coverage gate, no bundler).

Every new feature currently pays a "duplication tax": adding the Projects
feature (v1.5.0) required cloning the Users/Tags tree provider (+346 LOC), a
decoration module (+102 LOC), a focus module (+84 LOC), and hand-registering
its cache-clear in `extension.ts`. The next dimension (e.g. priority, due
dates) will pay the same tax again. This TDD defines the target architecture,
the defect fixes folded into the migration, and a phased, PR-sized migration
plan that keeps `main` releasable at every step.

## Current State Assessment

### Inventory (at baseline `2a4784d`, v1.6.0)

- **Runtime:** VS Code extension, `engines.vscode ^1.74.0`, `node >=20`.
  Activation on `onLanguage:markdown`. No runtime npm dependencies.
- **Source:** 38 `.ts` files, ~5,000 LOC, all in the repo root
  (`tsconfig.json` `include: ["*.ts"]`, `rootDir: "."`, `outDir: "out"`,
  CommonJS, ES2020, `strict: true`).
- **Modules by prefix convention:**
  - `extension.ts` (110 LOC) — activation glue / composition root.
  - `parser.ts`, `dates.ts`, `tokens.ts`, `types.ts` — domain logic
    (mostly pure; `parser.ts` and `types.ts` import `vscode` types).
  - `commands-*.ts` × 13 — command handlers.
  - `decoration-*.ts` × 5 (+ `decoration-incremental.ts` shared helper) —
    editor decorations with per-module cache/clear/incremental functions.
  - `tree-*.ts` × 3 providers + `tree-views.ts` wiring — activity-bar trees.
  - `focus-*.ts` × 4 — focus state + status-bar items.
  - `state.ts` — module-level `ExtensionContext` singleton + workspaceState
    accessors; `completions.ts`, `editor-events.ts`, `prompts.ts`,
    `auto-date.ts`, `project-view.ts` — supporting features.
- **Tests:** vitest (`test/**/*.test.ts`, 9 files, 751 LOC) with a
  hand-rolled `vscode` alias mock (`test/vscode-mock.ts`) and a `makeDoc`
  fixture helper. Coverage is concentrated on the v1.5/1.6 Projects feature
  slice; the mark-done matrix, archive, notes, dates, and most of the parser
  are untested. No coverage measurement.
- **CI:** `ci.yml` — compile (`tsc`), `vitest run`, package VSIX, upload
  artifact. `release.yml` — tag-driven marketplace publish + GitHub Release.
  No lint step, no markdownlint (config exists but nothing runs it), no
  Dependabot, single OS/Node combination.
- **Packaging:** `tsc` output shipped file-per-file from `out/`; no bundler.
- **Docs:** `README.md` (comprehensive), `CHANGELOG.md` (disciplined),
  `IMPROVEMENTS.md` (v1.4.2-era audit; partially stale — several items since
  completed), `example-todo.md`.

### Findings

Severity: **H** = defect or structural cost paid on every change,
**M** = friction / risk, **L** = polish.

| ID   | Sev | Finding                                                                                                                                                                                                              | Evidence                                                                  |
| ---- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| F-01 | H   | Flat root layout; filename prefixes simulate directories; `tsconfig` globs `*.ts` at root                                                                                                                            | repo root, `tsconfig.json:14`                                             |
| F-02 | H   | Triplicated tree providers — Users/Tags/Projects are the same provider modulo a key-extractor and node names                                                                                                         | `tree-users.ts` (337 LOC), `tree-tags.ts` (299), `tree-projects.ts` (346) |
| F-03 | H   | Quintuplicated decoration modules — identical `type` singleton + per-URI cache + `clear*Cache` + full/incremental update shape                                                                                       | `decoration-{tag,date,mention,project,dim}.ts`                            |
| F-04 | H   | Quadruplicated focus modules — identical status-bar item lifecycle + workspaceState get/set + pick-and-set command                                                                                                   | `focus-{user,tag,project,activity}.ts`                                    |
| F-05 | H   | No lint, no format check, no dependency-direction enforcement; `.markdownlint.json` exists but never runs                                                                                                            | `package.json:414-420`, `ci.yml`                                          |
| F-06 | H   | Timezone bug: `getToday()` returns the **UTC** date while `parseDate()`/`startOfToday()` are **local** — off-by-one dates written into files for users in negative UTC offsets in the evening                        | `dates.ts:2` vs `dates.ts:8,27`                                           |
| F-07 | H   | `markItemDone` CASE 4 performs two separate `editor.edit()` calls (delete, re-parse, insert) — a single undo restores half the operation; a concurrent edit sees the file mid-state                                  | `commands-mark-done.ts:138-167`                                           |
| F-08 | M   | Shell string interpolation in git calls — `exec("git log ... -- \"${filePath}\"")`; paths containing `` ` `` or `$` break or expand                                                                                  | `commands-history.ts:27-30,59-62`                                         |
| F-09 | M   | 18 copies of the `'Not a todo file. Add "md-todo: true"...'` guard across 18 files                                                                                                                                   | grep `"Not a todo file"`                                                  |
| F-10 | M   | `getEffectiveEditor` is a no-op wrapper imported by 19 files; `EffectiveEditorContext` exists only to serve it                                                                                                       | `parser.ts:99-101`, `types.ts:52-55`                                      |
| F-11 | M   | Manual cache-clear enumeration: `extension.ts` must list every module's `clear*Cache` in `onDidCloseTextDocument`; forgetting one leaks per-URI cache entries                                                        | `extension.ts:98-107`                                                     |
| F-12 | M   | Module-level mutable singletons throughout (`extensionContext`, 5 decoration types, 4 status-bar items, 6 caches); `deactivate()` is empty; decoration types and status bars are never disposed on deactivate        | `state.ts:13`, `decoration-*.ts`, `extension.ts:110`                      |
| F-13 | M   | `parser.ts` mixes four concerns: file detection, parsing, cursor/line geometry queries, and activity matching; domain types in `types.ts` import `vscode` (`Uri`, `QuickPickItem`), so no module is host-independent | `parser.ts`, `types.ts:1`                                                 |
| F-14 | M   | No bundler: VSIX ships ~38 separate JS files + source-map-less requires; slower activation, larger install than an esbuild single-file bundle                                                                        | `.vscodeignore`, `package.json:28`                                        |
| F-15 | M   | Test coverage is feature-lopsided (Projects slice only); no coverage metric or gate; `vscode-mock.ts` grows ad hoc                                                                                                   | `test/`                                                                   |
| F-16 | M   | Checkbox written lowercase `x` but parsed `[ xX]`; mixed-case files behave inconsistently with "already complete" checks                                                                                             | `commands-mark-done.ts:74`, `parser.ts:152`                               |
| F-17 | L   | `#tag`/`@user` regexes match inside code fences and HTML comments (false positives in trees, dim, decorations)                                                                                                       | `parser.ts:161-165`, decoration scan loops                                |
| F-18 | L   | No Dependabot/Renovate; CI on single Node (24)/OS (ubuntu); engines claim `>=20` but only 24 is exercised                                                                                                            | `.github/`                                                                |
| F-19 | L   | Stale docs: `IMPROVEMENTS.md` predates the module split (line anchors point into the old `extension.ts`); README "creates `md-todo-1.0.0.vsix`"                                                                      | `IMPROVEMENTS.md`, `README.md:47`                                         |
| F-20 | L   | `types.ts` mixes domain model, UI node unions, and prompt types in one file                                                                                                                                          | `types.ts`                                                                |

### What is already good (preserve, don't churn)

- The **parse cache** keyed by `(uri, version)` (`parser.ts:107-126`) and the
  incremental decoration paths — this perf work is recent and correct.
- The **vitest + vscode-alias mock** approach: fast, hermetic unit tests
  without the electron harness. The restructure builds on it, not around it.
- `tokens.ts` is a model module: single concern, documented regex hazards,
  zero `vscode` imports. The target `core/` layer generalizes exactly this.
- Small, single-purpose command files; the strict `isTodoFile` frontmatter
  opt-in as trust boundary; CI that packages a VSIX on every PR.

## Target Architecture

### Guiding principles

1. **Layered, dependency-direction-enforced.** `core/` is pure TypeScript
   with **zero `vscode` imports** (enforced by lint rule, not convention).
   `vscode/` adapters wrap host APIs. Features compose the two.
2. **Genericize the copy-paste axes.** Users/Tags/Projects are instances of
   one *keyed-grouping* abstraction; the five decorations are instances of
   one *decoration controller* abstraction; the four focus modules are
   instances of one *focus dimension* abstraction. Adding the next dimension
   (priority, due date) should mean writing a descriptor, not cloning files.
3. **One composition root.** All registration, disposal, and cross-module
   wiring happens in `extension.ts` + `registrations/`; no module self-wires
   through import side effects or module-level singletons.
4. **Behavior-preserving by default.** The migration is a refactor; the file
   format, command IDs, settings keys, and keybindings are frozen. The only
   behavior changes are the explicitly flagged defect fixes (F-06, F-07,
   F-08, F-16), each landing in its own reviewable commit with tests.
5. **`main` stays releasable.** Every phase is an independently shippable PR;
   CI packages a VSIX on each.

### Target directory layout

```text
md-todo/
├── src/
│   ├── extension.ts              # activate()/deactivate() — composition root only
│   ├── core/                     # PURE domain — no `vscode` import allowed
│   │   ├── model.ts              # TodoItem, ParsedDocument, definitions (host-free)
│   │   ├── text-document.ts      # TextDocumentLike minimal interface { lineCount, lineAt }
│   │   ├── parse/
│   │   │   ├── parser.ts         # parseDocument (pure, takes TextDocumentLike)
│   │   │   ├── sections.ts       # section map, classifyItemSection
│   │   │   └── detect.ts         # isTodoFile frontmatter check (pure)
│   │   ├── edit/
│   │   │   ├── line-transforms.ts# markLineComplete, tag/user/project line rewrites
│   │   │   └── plans.ts          # EditPlan builders: mark-done move, archive move
│   │   ├── query/
│   │   │   ├── items.ts          # findItemByLine, findItemForSourceLine, subtree end
│   │   │   └── activity.ts       # itemMatchesActivity, effective project
│   │   ├── dates.ts              # clock-injectable date logic (fixes F-06)
│   │   └── tokens.ts             # token regexes (moved as-is)
│   ├── vscode/                   # host adapters — the only layer beside features that imports vscode
│   │   ├── guards.ts             # requireTodoEditor(): editor+doc or warn-and-null (kills F-09/F-10)
│   │   ├── edit-executor.ts      # applies a core EditPlan as ONE WorkspaceEdit (fixes F-07)
│   │   ├── document-cache.ts     # (uri, version) parse memo + CacheRegistry (kills F-11)
│   │   ├── decoration-controller.ts # generic full/incremental/clear lifecycle (kills F-03)
│   │   ├── grouping-tree.ts      # generic keyed TreeDataProvider (kills F-02)
│   │   ├── focus-dimension.ts    # generic focus state + status bar + pick command (kills F-04)
│   │   ├── git.ts                # execFile-based git access (fixes F-08)
│   │   └── workspace-state.ts    # typed workspaceState keys (replaces state.ts)
│   ├── features/                 # one folder per user-facing capability
│   │   ├── items/                # add, quick-add, mark-done, add-note, archive
│   │   ├── tags/                 # descriptor + add/manage commands
│   │   ├── users/                # descriptor + add/assign commands
│   │   ├── projects/             # descriptor + set/manage commands + project view
│   │   ├── focus/                # user/tag/project/activity focus descriptors + dim
│   │   ├── decorations/          # tag/date/mention/project decoration descriptors
│   │   ├── reports/              # stats, history, activity reports
│   │   ├── completions/          # completion + hover providers
│   │   ├── auto-date/            # Enter-key date stamping
│   │   └── initialize/           # template + init command
│   └── registrations/
│       ├── commands.ts           # declarative command table → registerCommand loop
│       ├── views.ts              # tree views + welcome wiring
│       └── events.ts             # editor/document event fan-out (from editor-events.ts)
├── test/
│   ├── unit/                     # core/ tests — no vscode mock needed at all
│   ├── integration/              # feature tests against the vscode mock
│   ├── fixtures/                 # canonical todo documents (golden files)
│   └── mocks/vscode.ts           # the alias mock (moved, then grown deliberately)
├── Docs/
│   └── tdd/enterprise-restructure.md   # this document
├── esbuild.mjs                   # bundle src/extension.ts → dist/extension.js
├── eslint.config.mjs             # flat config; layering + no-vscode-in-core rules
├── tsconfig.json                 # rootDir src, noEmit (esbuild emits)
└── .github/workflows/            # ci.yml (lint+typecheck+test+coverage+package), release.yml
```

### Layering rules (lint-enforced)

```text
core/           → may import: core/ only.           (no vscode, no node APIs except types)
vscode/         → may import: core/, vscode api, node.
features/       → may import: core/, vscode/, vscode api.
registrations/  → may import: features/, vscode/, core/.
extension.ts    → may import: registrations/, vscode/.
test/unit       → may import: core/ only.
```

Enforced with `eslint-plugin-import` `no-restricted-paths` zones plus a
dedicated `no-restricted-imports` rule banning `vscode` inside `src/core/`.
CI fails on violation — the architecture cannot silently rot.

### Key abstractions

#### 1. `TextDocumentLike` — host-free parsing (F-13)

`core/` never sees `vscode.TextDocument`. It parses anything with:

```ts
export interface TextDocumentLike {
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string };
}
```

`vscode.TextDocument` is structurally assignable to this already (the current
test helper `makeDoc` proves it), so call sites don't change shape — only the
type they reference. Caching by `(uri, version)` stays in
`vscode/document-cache.ts`, because URIs and versions are host concepts.
`ParsedDocument` and `TodoItem` in `core/model.ts` drop their `vscode.Uri`
fields; tree-node types carry the URI at the feature layer where it belongs.

#### 2. `EditPlan` — atomic document mutations (F-07)

Commands currently interleave parse → `editor.edit()` → re-parse →
`editor.edit()`. Instead, `core/edit/plans.ts` computes a complete plan from
a parsed document:

```ts
export interface EditPlan {
    /** Line-ranged deletions/replacements/insertions, non-overlapping. */
    ops: EditOp[];
    /** Human summary for the info toast, e.g. `Completed: fix login`. */
    summary: string;
}
```

`vscode/edit-executor.ts` applies a plan as **one** `WorkspaceEdit`, so
mark-done's move-to-Completed is a single undo step and never observable
half-applied. Plans are pure data — trivially unit-tested against fixture
documents without any editor (the existing `writers-roundtrip.test.ts`
pattern generalizes to golden-file plan tests).

#### 3. `GroupingDescriptor` — one tree provider, three instances (F-02)

The three providers differ only in: which keys an item belongs to, where
definitions come from, node `contextValue` strings, and empty-group labels.

```ts
export interface GroupingDescriptor<TDef> {
    id: 'users' | 'tags' | 'projects';
    definitionsOf(parsed: ParsedDocument): TDef[];
    keysOf(item: TodoItem, parsed: ParsedDocument): string[];  // e.g. mentions, tags, [effectiveProject]
    keyOf(def: TDef): string;
    labelOf(def: TDef): string;
    unassignedLabel: string;                                   // "Unassigned" | "Untagged" | "No project"
    contextValues: { root: string; todo: string };
}
```

`vscode/grouping-tree.ts` implements `TreeDataProvider` once: current-URI
tracking, debounced refresh, section buckets (active/completed/archive),
counts, and tooltips. Feature folders supply descriptors. The existing
per-view context-menu commands keep their IDs and route to shared handlers
parameterized by descriptor. Net effect: ~980 LOC of triplication becomes
~350 LOC of engine + ~40 LOC per descriptor, and the next grouping dimension
is a descriptor, not a fourth clone.

#### 4. `DecorationController` — one lifecycle, five instances (F-03)

```ts
export interface DecorationSpec<TState = void> {
    id: string;
    createType(): vscode.TextEditorDecorationType;   // re-creatable on config change
    /** Compute options for one line; null state = full recompute required. */
    scanLine(line: string, lineNo: number, ctx: ScanContext): vscode.DecorationOptions[];
    /** Specs that can't shift incrementally (dim) opt out and full-scan. */
    incremental: boolean;
}
```

The controller owns: the type singleton + disposal, the per-URI cache, cache
clearing (registered with `CacheRegistry`), the full-scan path, and the
shared incremental shift/rescan logic currently in
`decoration-incremental.ts`. Dim remains special (subtree semantics) — it
becomes the one spec with `incremental: false`, keeping today's documented
fallback behavior. All controllers register their disposables and caches in
`context.subscriptions` / `CacheRegistry`, fixing the empty-`deactivate`
leak (F-12) and the manual clear enumeration (F-11).

#### 5. `FocusDimension` — one status-bar/focus engine, four instances (F-04)

Each focus module is: a workspaceState key, a status-bar item, a "pick then
set" command, a clear command, and a refresh hook. One `FocusDimension`
class parameterized by key, icon, pick source, and label formatter replaces
`focus-user.ts`, `focus-tag.ts`, `focus-project.ts`, and the state half of
`focus-activity.ts` (activity keeps its bespoke report commands in
`features/reports/`). `clearAllFocus` iterates registered dimensions.

#### 6. `requireTodoEditor` — one guard (F-09, F-10)

```ts
export function requireTodoEditor(editor: vscode.TextEditor | undefined):
    { editor: vscode.TextEditor; document: vscode.TextDocument } | undefined {
    // shows the canonical warning and returns undefined when not a todo file
}
```

Replaces all 18 duplicated guards and deletes `getEffectiveEditor` +
`EffectiveEditorContext` outright.

#### 7. Declarative command registry

`registrations/commands.ts` holds one table of
`{ id, handler, kind: 'command' | 'textEditor' }` rows. `activate()` loops
it. `package.json` `contributes.commands` and this table are asserted to
match by a unit test, so a missing registration or orphan contribution fails
CI instead of failing at runtime.

### Build, tooling, and CI target

| Area      | Target                                                                                                                                                                                                            | Rationale                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundling  | esbuild → single `dist/extension.js` (CJS, external: `vscode`, minified, sourcemap)                                                                                                                               | Marketplace best practice; faster activation; shrinks VSIX (F-14). VS Code extension host still requires CJS entry.                                       |
| Typecheck | `tsc --noEmit` as its own script/CI step                                                                                                                                                                          | esbuild does not typecheck; keep `strict` and add `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, `isolatedModules` |
| Lint      | ESLint flat config: `typescript-eslint` strict-type-checked + import-order + layering zones + `no-restricted-imports` (`vscode` in core)                                                                          | Encodes the architecture (F-05)                                                                                                                           |
| Format    | Prettier (4-space, single-quote, matching current style) + `--check` in CI                                                                                                                                        | Removes style from review                                                                                                                                 |
| Tests     | vitest, split `test/unit` (core, no mock) / `test/integration` (mock); v8 coverage with ratcheting thresholds (start at measured baseline, raise per phase, floor 80% on `core/`)                                 | F-15                                                                                                                                                      |
| Markdown  | `markdownlint-cli2` in CI (config already exists)                                                                                                                                                                 | F-05                                                                                                                                                      |
| Deps      | Dependabot for npm + github-actions, weekly                                                                                                                                                                       | F-18                                                                                                                                                      |
| CI matrix | Lint/typecheck/test on Node 20 + 24, ubuntu; package on ubuntu (the originally planned windows package smoke was not adopted — see Decision Log 2026-07-15 / Phase 6 closure audit; item CI-4 in IMPROVEMENTS.md) | F-18; matches `engines` claim                                                                                                                             |
| Scripts   | `build` (esbuild), `typecheck`, `lint`, `format:check`, `test`, `coverage`, `package`, `verify` (all of the above)                                                                                                | Single local entry point mirrors CI                                                                                                                       |

`package.json` `main` moves to `./dist/extension.js`; `.vscodeignore` updated
to ship only `dist/`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE`,
`example-todo.md`.

### Defect fixes folded into the migration (flagged behavior changes)

| ID      | Fix                                                                                                                                                                                                                                                                                                                        | Behavior change                                                                                                                                                                                                                                           | Status                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| F-06    | `core/dates.ts` takes an injectable `Clock`; `getToday()` derives from **local** time via `formatIsoDate(new Date())`, consistent with `parseDate`/`startOfToday`                                                                                                                                                          | Dates written near midnight in non-UTC zones change (become correct). Unit-testable via fixed clock.                                                                                                                                                      | Landed (Phase 2, this branch)  |
| F-07    | Mark-done CASE 4 becomes one `WorkspaceEdit` via `EditPlan`                                                                                                                                                                                                                                                                | Single undo step (previously two)                                                                                                                                                                                                                         | Landed (Phase 4, this branch)  |
| F-08    | `vscode/git.ts` uses `execFile('git', [...args], { cwd })`                                                                                                                                                                                                                                                                 | None visible; hardens paths with shell metacharacters                                                                                                                                                                                                     | Landed (Phase 4, this branch)  |
| F-16    | All checkbox writes normalize to lowercase `x`; parser unchanged (`[ xX]` accepted)                                                                                                                                                                                                                                        | Mixed-case files converge on write                                                                                                                                                                                                                        | Landed (Phase 4, this branch)  |
| U1 (3c) | Mark Done from a tree's context menu edits the document recorded on the clicked node (`node.sourceUri`) in all three trees                                                                                                                                                                                                 | Users tree previously used the provider's *current* URI: if the tree's file changed between render and click it could mark the same line number in the wrong document. Tags/Projects already behaved this way (see Appendix A)                            | Landed (Phase 3c, this branch) |
| F-17    | `core/parse/fences.ts` computes line-granular exclusion for fenced code blocks (backtick/tilde fences) and HTML comment blocks; `parseDocument` skips excluded lines entirely and the decoration layer skips them in token scans (the incremental path falls back to a full scan when the fence/comment structure changes) | Fake todos, section headers, definitions, and `#tag`/`@mention`/date tokens inside fences and comments disappear from trees, reports, decorations, and the dim overlay. Inline code spans on normal lines are unchanged (out of scope — see Decision Log) | Landed (Phase 5, this branch)  |

Anything else discovered mid-migration that changes behavior gets its own
row here and its own commit — never silently folded into a move.

## Migration Plan

Rules for every phase: one PR per phase (Phase 3 may split per axis); no
`git mv` mixed with content edits in the same commit (preserve
`git log --follow`); CI green including VSIX package; CHANGELOG entry under
`Unreleased`; **this document's status table updated in the same PR**.

### Phase 0 — Governance & tooling baseline (no source moves)

Adopt the guardrails first so every later phase is checked by them.

- Commit this TDD at `Docs/tdd/enterprise-restructure.md`.
- Add ESLint (flat config, typescript-eslint strict-type-checked; layering
  zones added in Phase 1 when `src/` exists), Prettier + check script,
  `markdownlint-cli2`, vitest coverage reporting (thresholds at measured
  baseline), Dependabot.
- CI: add `lint`, `typecheck` (`tsc --noEmit`), `format:check`,
  `markdownlint`, coverage steps; Node 20+24 matrix.
- Fix any violations the new linters surface (mechanical only).
- **Acceptance:** CI runs all gates green; VSIX byte-identical behavior
  (no `src/` change beyond lint autofixes).

### Phase 1 — Physical restructure: `src/` + esbuild

- `git mv` all root `.ts` files into the target folders (pure moves, import
  paths updated, **zero logic edits**): `parser/dates/tokens/types` →
  `src/core/` (still importing vscode where they do today — severed in
  Phase 2), `commands-*` → `src/features/...`, `decoration-*`,
  `tree-*`, `focus-*`, `completions`, `auto-date`, `editor-events`,
  `prompts`, `project-view`, `state` → their target folders;
  `test/vscode-mock.ts` → `test/mocks/vscode.ts`.
- Add `esbuild.mjs`; `main` → `dist/extension.js`; update `.vscodeignore`,
  `tsconfig` (`rootDir: src`, `noEmit: true`), scripts, CI, README build docs.
- Enable ESLint layering zones (core-vscode ban deferred to Phase 2).
- **Acceptance:** extension activates from the bundled VSIX with every
  command/view/decoration working (manual smoke per test checklist below);
  all tests pass; `git log --follow` intact on moved files.

### Phase 2 — Pure core: sever `vscode` from the domain (F-06, F-13, F-20)

- Introduce `TextDocumentLike`; split `types.ts` into `core/model.ts`
  (host-free) and feature-layer node types; split `parser.ts` into
  `core/parse/*` + `core/query/*`; move the parse cache to
  `vscode/document-cache.ts`.
- Land the **F-06 timezone fix** with clock-injected tests (own commit).
- Turn on the `no vscode in src/core` lint rule.
- Migrate `test/unit` to import `core/` directly — these tests drop the
  vscode alias entirely.
- **Acceptance:** `src/core/**` has zero `vscode` imports (lint-enforced);
  parser/date/token unit tests run without the mock; behavior unchanged
  except F-06.

### Phase 3 — Consolidate the copy-paste axes (F-02, F-03, F-04, F-09, F-10, F-11, F-12)

Sub-PR 3a: `requireTodoEditor` guard; delete `getEffectiveEditor` +
`EffectiveEditorContext`; replace all 18 guard copies.
Sub-PR 3b: `DecorationController` + five `DecorationSpec`s; `CacheRegistry`;
`deactivate()`/subscription disposal audit.
Sub-PR 3c: `GroupingDescriptor` + generic tree; Users/Tags/Projects become
descriptors; shared context-menu handlers (IDs frozen).
Sub-PR 3d: `FocusDimension` × 4; `clearAllFocus` iterates the registry;
`state.ts` replaced by `vscode/workspace-state.ts` typed keys (the
`ExtensionContext` singleton remains, contained, as the one host-lifecycle
concession — documented there).

- **Acceptance per sub-PR:** LOC of the axis drops materially (target:
  trees ~-600, decorations ~-250, focus ~-180 net); all existing tests pass;
  new engine-level unit tests added; manual smoke of the affected surface.

### Phase 4 — Command layer hardening (F-07, F-08, F-16)

- `EditPlan` + `edit-executor`; rewrite mark-done (all four cases) and
  archive as plans; **F-07 atomic-undo fix** (own commit, with plan-level
  golden tests for the four-case matrix).
- `vscode/git.ts` with `execFile` (**F-08**, own commit).
- Checkbox write normalization (**F-16**, own commit).
- Declarative command registry + `package.json` ↔ registry consistency test.
- **Acceptance:** mark-done four-case matrix covered by unit tests on plans;
  single undo restores fully; history command works in a path containing
  spaces and `$`.

### Phase 5 — Test depth & coverage ratchet (F-15, F-17)

- Golden-fixture tests for parser (sections, nesting, notes, dates, mixed
  case, frontmatter edge cases), archive, add-note, assign-user toggle,
  activity reports (snapshot), `parseNaturalDateRange` table tests.
- Decide and implement F-17 (ignore code fences/HTML comments in token
  scans) — parser-level, behind tests; flag in the table above if it lands.
- Raise coverage thresholds: `core/` ≥ 80% lines/branches; overall ≥ 60%.
- **Acceptance:** thresholds enforced in CI.

### Phase 6 — Documentation & closure (F-19)

- README: restructure Building/Development sections for `src/` + esbuild;
  fix stale version strings.
- `IMPROVEMENTS.md`: reconcile — mark items completed by this migration,
  fold still-open feature ideas into a `Docs/tdd/`-referenced backlog note,
  delete the stale line anchors, or retire the file in favor of issues.
- Final pass on this TDD: Status → **Complete**; record final metrics
  (LOC delta, coverage, VSIX size before/after).

## Migration Status (LIVING)

> Update this table in every PR that touches the migration. Statuses:
> `Not started` / `In progress (PR #n)` / `Done (PR #n, date)` / `Dropped (reason)`.

| Phase | Scope                                                                                           | Status                         | PR  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | TDD + tooling baseline (lint, format, coverage, markdownlint, Dependabot, CI gates)             | Done (this branch, 2026-07-15) | —   | ESLint strict + prettier + markdownlint + coverage (baseline 10.65% lines / 72.97% branches) + Dependabot + CI gates on Node 20/24                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1     | `src/` layout + esbuild bundling                                                                | Done (this branch, 2026-07-15) | —   | Pure `git mv` + import fixes; esbuild bundle + smoke test; layering zones on; VSIX 102 files/314 KB → 11 files/47 KB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2     | Pure `core/` + timezone fix (F-06)                                                              | Done (this branch, 2026-07-15) | —   | `TextDocumentLike`; `types.ts` → `core/model.ts` + `features/tree-nodes.ts`; parser → `core/parse/*` + `core/query/*`; cache/`isTodoFile` → `vscode/document-cache.ts`; F-06 fixed via `Clock` with `test/unit/dates.test.ts`; `no vscode in core` lint ban on; `test/unit/` runs mock-free                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3a    | `requireTodoEditor` guard (F-09/F-10)                                                           | Done (this branch, 2026-07-15) | —   | `vscode/guards.ts`; 20 guard copies across 18 files replaced (`grep "Not a todo file" src/` = 1, guards.ts only); `getEffectiveEditor` + `EffectiveEditorContext` deleted; focus pickers keep their distinct 'Open a todo file first' no-editor message — behavior unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3b    | `DecorationController` + `CacheRegistry` (F-03/F-11/F-12)                                       | Done (this branch, 2026-07-15) | —   | 13 characterization tests pinned first (`test/integration/decorations.test.ts`) and pass unchanged; `DecorationSpec` landed as a Line/Document union (see Decision Log); tag/date/mention/project are ~17-LOC descriptors, dim is the `incremental: false` spec keeping its no-focus short-circuit; caches clear via `CacheRegistry`; controllers/status bars/views all in `context.subscriptions`, `deactivate()` comment-only; decoration axis 701 → 514 LOC (−187, see Decision Log vs the −250 target)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3c    | Generic grouping tree (F-02)                                                                    | Done (this branch, 2026-07-15) | —   | Divergence audit recorded first (Appendix A: 18 preserved divergences, 1 unified — U1) and 9 characterization tests pinned the three trees' exact output before refactoring (pass unchanged after); `GroupingTreeProvider` + `GroupingDescriptor` in `vscode/grouping-tree.ts`; Users/Tags/Projects are descriptor modules + tree-specific handlers, shared mark-done/focus/cursor-command handlers in `features/tree-commands.ts`; the three node unions collapsed into `GroupingTreeNode<TDef>`; the provider is a `vscode.Disposable` whose dispose() cancels the pending debounce timer (pre-3c softness fixed, engine tests cover it); tree axis 1,238 → 733 LOC (−505, see Decision Log vs the −600 target)                                                                                                                                                                                                                                                          |
| 3d    | `FocusDimension` (F-04)                                                                         | Done (this branch, 2026-07-15) | —   | Divergence audit recorded first (Appendix B: 14 preserved divergences, zero accidental ones — no behavior change) and 21 characterization tests pinned the four focus surfaces before refactoring (pass unchanged after); `FocusDimension` + descriptors in `vscode/focus-dimension.ts`, user/tag/project/activity are descriptor modules registered via the `features/focus/index.ts` registry; the activity reports + menu moved (pure `git mv`) to `features/reports/activity-reports.ts` with command IDs frozen; `state.ts` → `vscode/workspace-state.ts` with phantom-typed `StateKey<T>` constants and generic get/update helpers, the `ExtensionContext` singleton contained there as the one documented host-lifecycle concession; `clearAllFocus` iterates the registry; focus axis 759 → 805 raw LOC but 677 → 613 executable (see Decision Log vs the −180 target)                                                                                             |
| 4     | `EditPlan` atomicity (F-07), `execFile` git (F-08), checkbox normalize (F-16), command registry | Done (this branch, 2026-07-15) | —   | 18 golden scenarios hand-traced through the OLD mark-done/archive code (the spec) pinned first, then `core/edit/plans.ts` + `vscode/edit-executor.ts` landed F-07: all four mark-done cases and archive build one plan from one snapshot and apply as ONE WorkspaceEdit — single undo, never observable half-applied; `vscode/git.ts` landed F-08 (execFile argv, proven against a scratch repo path containing spaces + `$HOME` + backticks; the only `child_process` import in src/); `normalizeCheckbox` landed F-16 on the rewriting write paths; `registrations/commands.ts` holds the 21-command table (+ `registrations/providers.ts` for completions), extension.ts imports registrations/+vscode/ only with the Phase 1 zone exception replaced by an enforcing zone, and the package.json ↔ registration consistency test asserts registry ∪ focus `commandIds` ∪ `treeCommandIds` = contributes.commands both ways (exception list: `mdTodo.activityFocusMenu`) |
| 5     | Test depth + coverage ratchet (F-15), token-scan fences decision (F-17)                         | Done (this branch, 2026-07-15) | —   | Test count 175 → 319: golden-fixture parser suite (test/fixtures/ + pinned quirks: duplicate-section last-wins, blank-line note orphaning, 20-line frontmatter window), core/query boundary tests, feature suites over a new editable-editor + FakeQuickPick harness (add-note, assign-focused-user incl. Robust-9 trailing token, activity-report and stats markdown snapshots on a fixed 2026-07-15 clock, promptForTodoText flow, auto-date Enter). F-17 landed (defect-fix row above). Coverage thresholds enforced in vitest (verified by impossible-threshold probe, exit 1) and `verify` now runs `coverage`: src/core/\*\* 98.65% lines / 96.81% branches (gate 80/80); overall src/\*\* 67.62% lines (gate 60) / 94.36% branches — vs the Phase 0 baseline 10.65% lines / 72.97% branches over the old flat layout                                                                                                                                                |
| 6     | Docs closure (F-19), TDD → Complete                                                             | Done (this branch, 2026-07-15) | —   | README accuracy pass (commands table completed + palette-exact titles, chord shortcuts fixed in Workflow, auto-date-on-Enter documented, Limitations + Architecture sections added); IMPROVEMENTS.md reconciled (38 Done / 40 Still open / 3 Dropped, status tables + preserved historical prose); CHANGELOG Unreleased consolidated; this TDD closed with the Outcome section below; `npm run verify` green (319 tests) and `vsce package` re-confirmed (11 files / 50.07 KB)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Decision log (LIVING)

Record every deviation from this design here, newest first.

| Date       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-16 | Post-implementation adversarial review loop resolved three findings from the "regressions vs main" review: (1) **fixed** — `.vscodeignore` had dropped main's `example-todo.md` exclusion when the Phase 1 rewrite switched it to an allowlist; restored the exclusion (removed the `!example-todo.md` line) so the file stays repo-only again; (2) **kept, no change** — esbuild `target: 'node20'` (vs the old per-file `tsc` target `ES2020`) is a conscious choice, not a regression: VS Code's extension host ships a bundled Node ≥20 runtime and `engines.vscode` was untouched, so the bundle can safely use newer runtime syntax/APIs than ES2020 allowed; (3) **kept, no change** — the new git-history error toast reads `Git error: <message>` instead of the old `Git error: ${error}` (which stringified an `Error` object to `Error: <message>`, producing a doubled "Error: Error:" prefix); the new wording is a strict cosmetic improvement, not a behavior change worth reverting. A second review agent tasked with hunting for latent engine defects (EditPlan math, decoration incremental correctness, tree/focus lifecycle) was aborted mid-run by an org API spend limit before producing findings; not retried in this pass — flagged to the maintainer as an open verification gap rather than silently treated as "clean" | `example-todo.md` is a bundled sample for contributors reading the repo, not something an installed extension needs at runtime — reinstating the exclusion matches the shipped-artifact intent main already had; the other two findings were graded not-a-regression on inspection (target compatibility confirmed against `engines.vscode`; error-message change confirmed cosmetic-only by reading the old vs. new toast call sites) so no code change was warranted, only this recorded judgment call |
| 2026-07-15 | Phase 6 closure audit: the CI target table promised the package smoke on windows + ubuntu, but CI runs ubuntu-only (checks job, Node 20/24 build+test matrix, package job). Not retrofitted at closure; recorded as still-open item CI-4 in the reconciled `IMPROVEMENTS.md`. Windows verification happens via the manual VSIX smoke handed to the maintainer (checklist item marked pending-human-verification)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | An OS axis added at the very end of the migration would exercise the packaging tooling, not the shipped artifact — the bundle is platform-independent JS and the real Windows risk (activation in a live editor) is exactly what the pending manual smoke covers                                                                                                                                                                                                                                         |
| 2026-07-15 | Phase 6: `IMPROVEMENTS.md` reconciled as a dated preamble + per-item status tables (38 Done / 40 Still open / 3 Dropped) with the original prose retained verbatim underneath as a labeled historical record, rather than trimming the prose or retiring the file into issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | The prose holds the reasoning behind each backlog idea, and this TDD and the README reference items by id (Feat-7, Robust-9, ...); the status tables stop the file lying about current state, while deleting the prose would orphan those references                                                                                                                                                                                                                                                     |
| 2026-07-15 | Phase 5 coverage ratchet: thresholds live in vitest (`coverage.thresholds`: global `lines: 60` over all included src files, glob group `src/core/**` at 80 lines / 80 branches), and the `verify` script now runs `coverage` instead of plain `test` so the gate binds locally exactly as in CI (whose coverage step already existed). Enforcement was proven by temporarily setting impossible values — vitest exits 1 naming the violated gate — then reverting. `model.ts`/`text-document.ts` report 0% (type-only modules are erased at runtime) but carry zero executable lines, so they do not drag the core aggregate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A threshold that only CI sees invites red-CI surprises; the impossible-threshold probe is the cheapest way to prove the gate is real rather than silently misconfigured                                                                                                                                                                                                                                                                                                                                  |
| 2026-07-15 | Phase 5 / F-17 scope: fence/comment exclusion is LINE-granular. Excluded lines: fence delimiters and fence bodies (opening fence may carry an info string; a closing fence must be alone on its line; an unclosed fence runs to EOF; backtick and tilde fences do not close each other), lines whose first non-whitespace content is an HTML comment opener, and continuation lines of an unclosed `<!--` up to and including the `-->` line. A line with real content BEFORE a trailing `<!--` opener stays real (only its continuation is excluded). Inline code spans on normal lines (a `#tag` inside single backticks) remain matched — span-level handling beyond fences is explicitly OUT OF SCOPE, and the date/project tokens REQUIRE backticks by design and must not break. Completion/hover providers still fire inside fences (out of scope, parser-fed surfaces are already covered)                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Line granularity covers the whole reported false-positive class (code samples containing fake todos/tokens) with one O(N) regex pass shared by parser and decorations; span-level inline handling would need a markdown inline parser for marginal benefit                                                                                                                                                                                                                                               |
| 2026-07-15 | Phase 5 / F-17 decorations: exclusion is enforced by `DecorationController` (line specs filter excluded lines in full and incremental scans; dim's span loop filters too), and the incremental shift/re-scan path falls back to a FULL scan when a change's inserted text contains a fence/comment marker OR the document's marker-line COUNT differs from the one recorded at the last full scan — the count signature catches marker-line deletions, whose removed text is unobservable from the change event. Residual accepted gap: a single multi-cursor event that deletes one marker line and simultaneously creates another via typed non-marker text keeps the count equal and could serve a stale shifted cache until the next full scan (editor switch / config change)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The sanctioned "fall back on marker characters" heuristic alone misses deletions; the marker-line count is state-independent, costs nothing extra (computed in the same pass as the exclusion flags), and keeps the common typing path incremental                                                                                                                                                                                                                                                       |
| 2026-07-15 | Phase 4: `EditOp` landed as a whole-line op union (`replaceLines` / `deleteLines` / `insertLines`) in original-document coordinates, rather than the sketch's unspecified line-ranged ops; the builders reproduce the OLD `editor.edit()` end-of-document position clamps exactly (a moved block reaching the last line leaves one empty line behind; a Completed/Archive header ending the document gets the block appended after it with a trailing blank; header + blank ending the document lands the block before the blank); `buildArchivePlan` returns `null` when nothing qualifies, and `applyPlan` itself shows the plan summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Whole-line ops map 1:1 onto both the plain string-array applier in the golden tests and the executor's WorkspaceEdit ranges, so tests and runtime share one documented semantics; the clamp quirks are user-visible FINAL text and the old behavior is the spec; the nothing-to-archive message needs `archiveAfterDays`, which only the command holds                                                                                                                                                   |
| 2026-07-15 | Phase 4: F-16 normalization runs only where a write path already rewrites the checkbox line — `markLineComplete` (all mark-done paths), archive's moved blocks, and the auto-date Enter stamp; the token-rewrite commands (add-tags, set-project, assign-focused-user) still preserve the checkbox as typed; `markLineComplete` moved to `core/edit/line-transforms.ts` as a content move, not a `git mv`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | The token commands treat everything outside their token as opaque line content and are not in F-16's audited write scope ("do not mass-rewrite untouched lines" extends to untouched line *parts*); mixed-case boxes on those lines converge the next time a covered path rewrites them; the content move is noted because the function was a small slice of commands-mark-done.ts, so rename detection was never applicable                                                                             |
| 2026-07-15 | Phase 4: the command registry covers exactly what extension.ts itself registered (21 commands); focus-dimension and tree commands keep their 3d/3c self-registration and instead export their IDs (`RegisteredFocusDimension.commandIds`, views.ts `treeCommandIds`) for the consistency test; a new `registrations/providers.ts` (absent from the target layout) holds the completion/hover registration, and `registerAutoDateHandler` is re-exported through `registrations/events.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Dissolving the descriptors' self-registration would undo the 3c/3d encapsulation; with the tightened zone extension.ts may import only registrations/ + vscode/, so its two remaining direct feature registrations needed a registrations/ home; views.ts's handler record is keyed by the exported id tuple, so the exported list and the actual registrations cannot drift (compile error)                                                                                                             |
| 2026-07-15 | Phase 3d: `FocusDimensionDescriptor` grew beyond the sketch — `statusBar.command` is separate from `pick.commandId` (they coincide for user/tag/project but activity's click opens the external menu), `pick` is optional (activity has no definitions pick), `clearCommandId` is optional (only activity has one), a `setState` (raw write) vs `set` (write + side effects) split exists for the tree handlers' asymmetric repaint scope, and the `onDidChange` dim-repaint hook is injected by the feature layer; a T-free `RegisteredFocusDimension` interface backs the `focusDimensions` registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | The Appendix B audit found the command topology differs per dimension (rows B3/B9/B13); the engine lives in `vscode/` which may not import `features/` (dim decoration) under the layering zones, so the side effect is a descriptor field; `FocusDimension<T>` is invariant in T, so the registry needs the T-free structural interface                                                                                                                                                                 |
| 2026-07-15 | Phase 3d: `workspace-state.ts` exposes phantom-typed `StateKey<T>` constants + generic `getWorkspaceState`/`updateWorkspaceState` instead of per-key getter/setter pairs; `getExtensionContext` deleted — the singleton is fully private; the reports move and the state.ts rename were each landed as dedicated pure-move commits before their content edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | One read/write pair can't drift per key, and a key can never be read at one type and written at another; nothing outside the module needs the raw context anymore (the grouping trees take a `Memento` at construction); the pure-move commits preserve `git log --follow` per the migration rules (same as the Phase 2 parser split)                                                                                                                                                                    |
| 2026-07-15 | Phase 3d: focus-axis LOC landed at +46 raw / −64 executable (759 → 805 raw, 677 → 613 code lines, both sides counting state.ts→workspace-state.ts and the unshrinkable 317-line activity reports that only changed folders) against the ~−180 target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The −180 target predates the 1.6 report features that grew focus-activity.ts to 359 lines, and — same shape as 3b/3c — the engine (220 lines, ~86 of them doc comments) documents the full audited contract; the mechanics-only duplication removed is real but the three clones were small (~100 LOC each); the durable win is that dimension five costs a ~35-line descriptor + one registry entry, and workspaceState access is now type-checked                                                      |
| 2026-07-15 | Phase 3c: `GroupingDescriptor` grew beyond the sketch — `syntheticDefinitionsOf` (Projects' used-but-undefined roots), `rootDescriptionOf`/`rootTooltipHeaderOf`/`rootIconOf` formatters, `unassignedIcon`/`unassignedTooltipHeader`, and `contextValues` expanded to `{root, unassigned, section, todo}`; `keysOf` takes only the item (no `parsed` parameter) and roots sort case-insensitively by `keyOf`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | The Appendix A audit found 18 divergences where the sketch anticipated ~7: Projects' inherited-project matching and synthetic warning-icon roots, Users' `@shortname` description prefix, and the per-tree icons/tooltip headers all needed descriptor fields; all four contextValues (not just root/todo) are referenced from `package.json` menus, so all are frozen descriptor inputs; no key extractor needed the parse, so the parameter was dropped                                                |
| 2026-07-15 | Phase 3c: shared tree context-menu handlers live in `features/tree-commands.ts`, not in `vscode/grouping-tree.ts`; the U1 unification (mark-done-from-tree targets `node.sourceUri` in all three trees) is the one behavior change; `features/tree-nodes.ts` deleted — node aliases live in the descriptor modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | The handlers call feature code (`markDone`, dim repaint, focus status bars) that the `vscode/` layer may not import under the layering zones; the Users tree's provider-current-URI form could mark a line in the wrong file if the tree's file changed after the node was built (Appendix A row U1, defect-fix row below); with the unions collapsed into `GroupingTreeNode<TDef>` a separate shared types file had nothing left to share                                                               |
| 2026-07-15 | Phase 3c: tree-axis LOC landed at −505 (1,238 → 733; `registrations/views.ts` dropped a further 9) against the ~−600 target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Same shape as 3b: the engine keeps full doc comments and the audit-preserved formatters cost descriptor lines the sketch didn't count; executable-code reduction is on target and the next grouping dimension costs a ~25-line descriptor instead of a ~400-line clone                                                                                                                                                                                                                                   |
| 2026-07-15 | Phase 3b: `DecorationSpec` is a discriminated union — `LineDecorationSpec` (`incremental: true`, `scanLine`) and `DocumentDecorationSpec` (`incremental: false`, `scanDocument` + `isEmptyState`) — instead of the sketched single `scanLine` + flag; specs may declare `configKeys` so the controller rebuilds the type on config change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Dim's whole-document subtree semantics cannot be expressed as a per-line scan, and its documented no-focus short-circuit needs an explicit `isEmptyState` hook; the date decoration's opacity is config-driven, so type re-creation needed a declarative trigger (`mdTodo.dateOpacity`) rather than a hand-wired event branch                                                                                                                                                                            |
| 2026-07-15 | Phase 3b: controller instances are module-level `const`s exported by the descriptor modules (registering their caches with `CacheRegistry` at module initialization, like the parse cache); `registrations/events.ts` iterates the list and pushes the controllers into `context.subscriptions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Focus and tree features call dim's update directly on focus changes, so the instance must be importable; the constructors touch no `vscode` API at module scope (types are lazy), keeping the bundle smoke-test contract; a contained exception to the "no module-level singletons" principle, matching the sanctioned parse-cache self-registration                                                                                                                                                     |
| 2026-07-15 | Phase 3b: decoration-axis LOC landed at −187 (701 → 514) against the ~−250 target; dim's descriptor is 105 LOC against the <60 ideal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The incremental shift/re-scan machinery kept its full documentation (~90 comment lines) when absorbed into `decoration-controller.ts`, and dim's subtree-matching logic is irreducible; executable-code reduction is on target and each future line-token decoration costs ~17 LOC                                                                                                                                                                                                                       |
| 2026-07-15 | Phase 2: cursor/editor queries land in a new `vscode/editor-queries.ts` (`findItemAtCursor` over the cached parse + pure `findItemByLine`; `getEffectiveEditor` + `EffectiveEditorContext` parked there unchanged); `SuggestionItem` is defined in `vscode/prompts.ts` beside its only consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | These consume `vscode.TextEditor`/`QuickPickItem` so they cannot live in `core/`; the target layout had no named home for them. `editor-queries.ts` keeps the Phase 3a deletions (`getEffectiveEditor`, `EffectiveEditorContext`) in one disposable file                                                                                                                                                                                                                                                 |
| 2026-07-15 | Phase 2: tree-node unions live in one shared `src/features/tree-nodes.ts` rather than per-feature files; `isNoteLine`/`isNestedTodoLine` live in `core/query/items.ts`, so `core/parse/parser.ts` imports from `core/query/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A single node-types file avoids three-way churn that Phase 3c's `GroupingDescriptor` consumes/replaces wholesale; the line classifiers are shared by parsing and line-geometry queries, and a parse→query import inside `core/` breaks no layering rule                                                                                                                                                                                                                                                  |
| 2026-07-15 | Phase 2: `parser.ts` relocated as a pure-move commit followed by a separate content-split commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The split keeps <50% of the file, which would defeat `git log --follow` rename detection if mixed with the move; matches the "no `git mv` mixed with content edits" migration rule                                                                                                                                                                                                                                                                                                                       |
| 2026-07-15 | Phase 1 layering zones: `extension.ts` temporarily allowed to import `features/` and `core/`; feature-to-feature imports not banned yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Zero-logic-edit constraint: the composition root registers feature handlers until the Phase 4 command registry, and enumerates `core/` cache clears until the Phase 3b `CacheRegistry`; cross-feature imports are exactly the Phase 3 duplication being consolidated                                                                                                                                                                                                                                     |
| 2026-07-15 | Initial design accepted as drafted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Outcome (final metrics, 2026-07-15)

Measured on this branch at Phase 6 closure, against baseline `2a4784d`
(v1.6.0). Source counts are `wc -l` over `.ts` files (comments and blanks
included); the per-axis executable-code deltas are in the Decision Log rows
for Phases 3b/3c/3d.

| Metric                    | Baseline `2a4784d` (v1.6.0)                | Final (this branch)                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source layout             | 39 `.ts` modules flat in the repo root     | 60 modules in layered `src/` (`core/` 12, `vscode/` 11, `features/` 32, `registrations/` 4, extension.ts)                                                                                                         |
| Source LOC                | ~5,007                                     | 5,588 (+581 raw; the duplicated axes shrank — trees −505, decorations −187, focus −64 executable — while the engines carry full doc comments and new modules landed: EditPlan/executor, fences, guards, registry) |
| Tests                     | 49 tests / 9 files / 751 LOC               | 319 tests / 28 files / 5,524 LOC (+ golden fixtures)                                                                                                                                                              |
| Coverage (lines/branches) | 10.65% / 72.97% (measured, no gate)        | 67.62% / 94.36% overall; `src/core/**` 98.65% / 96.81% — gated in CI and locally (core ≥ 80/80, overall ≥ 60)                                                                                                     |
| VSIX                      | 102 files / 314 KB (per-file `tsc` output) | 11 files / 50.07 KB (single esbuild bundle; 47 KB at Phase 1, +3 KB from Phases 2–5 code and the Phase 6 README)                                                                                                  |
| Lint/format/markdown/deps | none running                               | ESLint (strict + layering zones + core-vscode ban), Prettier, markdownlint-cli2, Dependabot — all CI gates                                                                                                        |
| CI                        | compile + test + package, Node 24, ubuntu  | typecheck/lint/format/markdownlint + build/smoke/coverage on Node 20+24 + package, ubuntu                                                                                                                         |

**Behavior changes shipped** (each in its own commit, all other behavior
frozen and pinned by characterization tests):

1. **F-06** — timezone off-by-one: all "today" derivations agree on local time.
2. **F-07** — mark-done/archive apply as one `WorkspaceEdit`: single undo, never observable half-applied.
3. **F-08** — git history via `execFile` argv: paths with spaces/`$`/backticks/quotes work.
4. **F-16** — checkbox writes normalize `[X]` → `[x]` on rewriting paths.
5. **F-17** — fenced-code / HTML-comment lines excluded from parsing and decorations.
6. **U1** — tree mark-done targets the clicked node's source file in all three trees (the Users tree could previously edit the wrong file).

## Alternatives Considered

| Alternative                                                                    | Why rejected                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep the flat layout; only add lint/tests**                                  | Cheapest, but leaves the duplication tax: every new dimension re-clones ~800 LOC across tree/decoration/focus. The structural cost, not style, is the problem statement.                                                     |
| **Big-bang rewrite on a long-lived branch**                                    | Highest defect risk for a solo-maintained, released extension; conflicts with in-flight branches (`markdown-render-tag-date-styling`); violates the "main stays releasable" constraint. Phased PRs are strictly safer.       |
| **webpack instead of esbuild**                                                 | Both are supported by `vsce`; esbuild is simpler, dramatically faster, and the current official sample default. No loader needs justify webpack here.                                                                        |
| **Full DI container / class-per-service architecture**                         | Over-engineering for a ~5k LOC extension with no runtime deps. Function modules + a composition root + three generic engines achieve the reuse without framework ceremony.                                                   |
| **Runtime abstraction over the whole VS Code API (ports/adapters everywhere)** | The `TextDocumentLike` + `EditPlan` seams cover 90% of the testability win at 10% of the indirection. Wrapping window/QuickPick/etc. wholesale adds layers nobody debugs happily.                                            |
| **Switch tests to `@vscode/test-electron`**                                    | Real-host integration tests are slow, flaky in CI, and the alias-mock approach already exists and works. Revisit only if mock-vs-host drift causes an actual escaped bug (note in Risks).                                    |
| **Adopt ESM output**                                                           | VS Code's extension host requires a CJS entry point; ESM extension support is not generally available for the targeted engine range (`^1.74.0`). esbuild emits CJS from ESM-style sources, which is the standard compromise. |
| **Monorepo split (core as separate npm package)**                              | Premature; nothing else consumes the core. The lint-enforced `core/` boundary delivers the same discipline and keeps releases simple. A package split remains trivially possible later precisely because of that boundary.   |

## Design Risks & Assumptions

- **Assumption:** VS Code extension host keeps requiring a CJS entry for
  `engines.vscode ^1.74.0`. If the minimum engine is raised substantially
  later, revisit ESM — nothing in this design blocks it.
- **Assumption:** The vscode alias mock remains adequate for feature tests.
  *Risk:* mock drift from real host behavior. *Mitigation:* mock grows only
  deliberately (Phase 5 moves it under `test/mocks/` with its own review
  care); escape hatch documented in Alternatives.
- **Risk:** File moves break `git log --follow` / blame ergonomics.
  *Mitigation:* moves are dedicated commits with no content edits; rename
  detection then works. `.git-blame-ignore-revs` added for the format-only
  commit in Phase 0.
- **Risk:** In-flight branches (`markdown-render-tag-date-styling`) conflict
  with the Phase 1 moves. *Mitigation:* land or rebase in-flight work before
  Phase 1; Phase 1 is announced in the PR description as a merge barrier.
- **Risk:** Genericizing the trees/decorations obscures a subtle behavioral
  asymmetry between the three current copies. *Mitigation:* before 3b/3c,
  diff the triplets and record every intentional divergence in the Decision
  Log; characterization tests pin current outputs first.
- **Risk:** Bundling changes runtime behavior (e.g. `__dirname`, dynamic
  requires). *Audit result:* no dynamic requires exist; only `child_process`
  and `util` node imports (git feature). Marked external-safe. Manual smoke
  checklist gates Phase 1.
- **Risk:** The timezone fix (F-06) changes dates users see. *Mitigation:*
  own commit, CHANGELOG "Fixed" entry, README limitation note removed.
- **Risk:** Solo-project cadence stalls mid-migration, leaving a hybrid
  layout. *Mitigation:* every phase ends in a coherent, documented state;
  the Status table makes "where we are" legible to any future session.

## Feature Switch

Not applicable in the runtime sense — this is a structural refactor with
frozen user-facing behavior (command IDs, settings, keybindings, file format
all unchanged). The safety mechanisms instead are:

- **Behavior freeze + characterization tests** before each consolidation.
- **Flagged-fix isolation:** the four behavior changes (F-06/07/08/16) land
  as individual commits, individually revertable.
- **Per-phase VSIX artifacts** from CI enable instant A/B of any phase.
- **Marketplace rollback:** any regression escapes are handled by
  re-publishing the previous tag, which the release workflow supports.

## Requirements Checklist (Definition of Done)

- [x] All source under `src/` in the target layout; repo root contains no `.ts` (verified: `find . -maxdepth 1 -name '*.ts'` empty; the vitest config is `vitest.config.mjs`)
- [x] `src/core/**` imports no `vscode` — enforced by ESLint in CI (verified: grep empty + `no-restricted-imports` rule in `eslint.config.mjs`)
- [x] Layering zones enforced in CI; violations fail the build (`import-x/no-restricted-paths` zones in `eslint.config.mjs`; `npm run lint` is a CI step)
- [x] One generic tree engine, decoration controller, and focus dimension; Users/Tags/Projects/decorations/focus are descriptors
- [x] Zero copies of the "Not a todo file" guard outside `vscode/guards.ts`
- [x] `getEffectiveEditor` and `EffectiveEditorContext` deleted
- [x] Mark-done (all cases) and archive apply as a single `WorkspaceEdit`; one undo restores fully — covered by tests
- [x] `getToday()`/`parseDate()`/`startOfToday()` agree on local time; clock-injected tests cover the midnight boundary (`test/unit/dates.test.ts`)
- [x] Git history feature uses `execFile`; test path with spaces + `$` passes
- [x] Every decoration type, status-bar item, tree view, and cache is disposed/cleared via `context.subscriptions`/`CacheRegistry`; `deactivate` verified leak-free (the tree providers' debounce-timer softness was resolved in Phase 3c: `GroupingTreeProvider` is a `vscode.Disposable` in `context.subscriptions` whose `dispose()` cancels the pending timer)
- [x] esbuild bundle ships; VSIX contains a single `dist/extension.js` (11 files / 50.07 KB, re-confirmed at closure). **Pending human verification:** manual activation smoke on Windows + Linux — a VSIX will be handed to the maintainer; the automated bundle smoke (`npm run smoke`) and the CI package job cover export shape only, not a live editor
- [x] CI gates: lint, format, typecheck, markdownlint, tests, coverage (core ≥ 80%, overall ≥ 60%, enforced thresholds), package; Node 20 + 24
- [x] Command registry ↔ `package.json` contributions consistency test
- [x] Dependabot active for npm + actions (`.github/dependabot.yml`, weekly)
- [x] README build/dev docs match the new layout; `IMPROVEMENTS.md` reconciled (Phase 6, 2026-07-15)
- [x] This TDD's Status table shows every phase `Done` and Status → Complete (implementation; human smoke + PR review remain)

## Out of Scope

Explicitly **not** part of this migration (candidates for future TDDs; most
are catalogued in `IMPROVEMENTS.md`):

- New user-facing features: priority/due-date/recurring markers, checkbox
  CodeLens click-to-toggle, multi-file aggregation, export/report additions,
  drag-and-drop trees, configurable colors/sections. The restructure makes
  these cheaper; it does not ship them.
- File-format changes of any kind (the `md-todo: true` trust boundary,
  section names, and token syntax are frozen).
- Marketplace/branding work, screenshots, demo GIFs.
- `@vscode/test-electron` real-host integration harness (see Alternatives).
- Localization, telemetry, or web-extension (`browser` target) support —
  the pure-`core/` split incidentally moves toward web compatibility, but
  the git feature's `child_process` use keeps it desktop-only for now.

## Living Document Protocol

1. **Same-PR updates.** Any PR that advances, reorders, drops, or adds
   migration work updates the [Migration Status](#migration-status-living)
   table (and Decision Log if the design changed) in that PR. A migration PR
   that doesn't touch this file is incomplete by definition.
2. **Design changes are decisions.** If implementation reality contradicts
   this document, the document is corrected *and* the deviation is recorded
   in the Decision Log with rationale — the doc states intentions *and*
   what actually happened, never a fiction.
3. **Findings are append-only.** New problems discovered mid-migration get
   the next F-nn id and a home in a phase (or an explicit `Dropped` row).
4. **Completion.** When all phases are `Done`, Status flips to Complete and
   the doc remains as the architectural record; day-to-day reference docs
   (README/Docs) take over for "how it works now".

## References

- Baseline audit: `IMPROVEMENTS.md` (v1.4.2-era; partially completed since —
  reconciliation is Phase 6)
- Current architecture entry points: `extension.ts`, `editor-events.ts`,
  `tree-views.ts`, `state.ts`, `parser.ts`
- Duplication triplets: `tree-{users,tags,projects}.ts`,
  `decoration-{tag,date,mention,project,dim}.ts`,
  `focus-{user,tag,project,activity}.ts`
- VS Code extension bundling guidance (esbuild) and `vsce` packaging docs
- typescript-eslint strict-type-checked preset; `eslint-plugin-import`
  `no-restricted-paths`
- CI/release workflows: `.github/workflows/{ci,release}.yml`

## Appendix A — Phase 3c divergence audit (Users / Tags / Projects trees)

Produced by a side-by-side diff of `tree-users.ts` / `tree-tags.ts` /
`tree-projects.ts` **before** the `GroupingDescriptor` consolidation, per the
"diff the triplets" mitigation in Design Risks. Everything not listed under
"Intentional divergences" below was byte-identical modulo type names and is
absorbed into the engine unchanged.

### Identical across all three (absorbed into the engine)

- Current-URI tracking: `setCurrentTodoFile` no-ops on same URI, persists to
  `workspaceState`, fires a full refresh; constructor restores the last URI.
- `refresh()` (immediate) + `refreshDebounced()` (200 ms, timer coalesced).
- `getCurrentParsed()` via `vscode.workspace.openTextDocument` +
  `isTodoFile` gate + memoized `parseDocument`; any failure → empty tree.
- Recursive traversal (item + all descendants) for both counts and buckets.
- Section bucketing via `classifyItemSection`; fixed `active → completed →
  archive` order; **empty sections omitted**; section nodes always Expanded;
  labels `Active (n)` / `Completed (n)` / `Archive (n)`; icons
  `list-unordered` / `check-all` / `archive`.
- Root/unassigned nodes: Collapsed iff `active+completed+archived > 0`,
  else None; description `(n active)` (Users adds a prefix, see D3); tooltip
  is a header line + `\nActive: a  Completed: c  Archive: r`.
- Todo nodes: label `item.text || '(untitled)'`; description
  `done <date>` / `done` / `added <date>` / `''`; tooltip `item.raw`; icon
  `check` / `circle-outline`; click command `vscode.open` with
  `{ selection: Range(line,0,line,0), preview: false }`.
- Roots sorted case-insensitively by group key; unassigned bucket appended
  last.
- Focus-from-tree handlers: focus **set** repaints dim in *all* visible
  editors; focus **clear** repaints only todo-file editors. This asymmetry
  is identical in all three copies and is preserved as-is.

### Intentional divergences (preserved via descriptor fields)

| #   | Axis                      | Users                                           | Tags                             | Projects                                                      | Descriptor field                     |
| --- | ------------------------- | ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| D1  | workspaceState key        | `mdTodo.users.lastTodoFileUri`                  | `mdTodo.tags.lastTodoFileUri`    | `mdTodo.projects.lastTodoFileUri`                             | derived from `id`                    |
| D2  | Root label                | `fullname`                                      | `#<name>`                        | `<name>`                                                      | `labelOf`                            |
| D3  | Root description          | `@<shortname>  (n active)` (two spaces)         | `(n active)`                     | `(n active)`                                                  | `rootDescriptionOf` (engine default) |
| D4  | Root tooltip header       | `<fullname> — <description>`                    | `#<name> — <description>`        | `[<name>] — <description>`                                    | `rootTooltipHeaderOf`                |
| D5  | Root icon                 | `person`                                        | `tag`                            | `project`; `warning` for synthetic roots (`line === -1`)      | `rootIconOf(def)`                    |
| D6  | Root contextValue         | `user`                                          | `tag-root`                       | `project-root`                                                | `contextValues.root`                 |
| D7  | Group membership          | `mentions.includes(shortname)`                  | `tags.includes(name)`            | `getEffectiveProject(item) === name` (children inherit)       | `keysOf(item)`                       |
| D8  | Unassigned membership     | `mentions.length === 0`                         | `tags.length === 0`              | `getEffectiveProject(item) === undefined`                     | `keysOf(item).length === 0`          |
| D9  | Unassigned label          | `Unassigned`                                    | `Untagged`                       | `No Project`                                                  | `unassignedLabel`                    |
| D10 | Unassigned icon           | `person-add`                                    | `circle-slash`                   | `circle-slash`                                                | `unassignedIcon`                     |
| D11 | Unassigned tooltip header | `Todos with no @mention`                        | `Todos with no #tag`             | `Todos with no [project]`                                     | `unassignedTooltipHeader`            |
| D12 | Unassigned contextValue   | `unassigned`                                    | `untagged`                       | `no-project`                                                  | `contextValues.unassigned`           |
| D13 | Section contextValue      | `section`                                       | `tag-section`                    | `project-section`                                             | `contextValues.section`              |
| D14 | Todo contextValue         | `todo`                                          | `tag-todo`                       | `project-todo`                                                | `contextValues.todo`                 |
| D15 | Synthetic roots           | —                                               | —                                | used-but-undefined project names appended after defined roots | `syntheticDefinitionsOf`             |
| D16 | Root sort key vs label    | sorts by `shortname`, labels by `fullname`      | sorts by `name` (= label sans #) | sorts by `name` (= label)                                     | sort by `keyOf(def)`                 |
| D17 | Tree-specific commands    | `reassignUser`                                  | `editTagsFromTree`               | `setProjectFromTree`, `showProjectViewFromTree`               | stay in feature modules              |
| D18 | Focus warn message        | "Right-click a user in the MD Todo Users view." | "…a tag…Tags view."              | "…a project…Projects view."                                   | parameter of shared focus handler    |

Command IDs and contextValues are frozen (referenced from `package.json`
`contributes.menus` `viewItem ==` clauses) — the descriptor carries them
verbatim.

### Accidental divergences unified (behavior changes)

| #   | Axis                            | Users (old)                                                                           | Tags/Projects (old) | Unified to                                                                                                                                                                                       |
| --- | ------------------------------- | ------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | mark-done-from-tree target file | `treeProvider.getCurrentUri()` (silently returns if unset; ignores the node's origin) | `node.sourceUri`    | `node.sourceUri` — the Users variant could mark the wrong file's line if the tree's current file changed between node construction and the context-menu click; the Tags/Projects form is correct |

`reassignUserFromTree` also reads `treeProvider.getCurrentUri()`, but it has
no counterpart in the other trees to unify against; it keeps its existing
behavior unchanged.

## Appendix B — Phase 3d divergence audit (focus modules)

Produced by a side-by-side read of `focus-user.ts` (95 LOC) /
`focus-tag.ts` (83) / `focus-project.ts` (84) / `focus-activity.ts` (297)
**before** the `FocusDimension` consolidation, per the "diff the triplets"
mitigation in Design Risks. `focus-activity.ts` is two things in one file:
a focus dimension (state + status bar + clear) that joins the engine, and
the activity **reports** (`showRecentlyCompleted` / `showRecentlyAdded` /
`showStaleItems`, `pickDateRange`, `pickStaleThreshold`,
`renderCompletedItemLines`, `openActivityReport`, `activityFocusMenu`) that
are not focus mechanics and move to `features/reports/activity-reports.ts`
with their command IDs frozen.

### Identical across user/tag/project (absorbed into the engine)

- Status-bar item lifecycle: module-level `let`; `init*` creates the item
  with `StatusBarAlignment.Right` + a per-dimension priority, sets
  `item.command` to the dimension's pick command, pushes it into
  `context.subscriptions`. Activity follows the same shape (its click
  command is the menu, see B3).
- `refresh*(editor)`: item never created → no-op; `!editor ||
  !isTodoFile(document)` → `hide()`; focus unset → "All ..." text +
  "No ... focus — click to ..." tooltip; focus set → token text +
  "Focused on ... — click to change" tooltip; then `show()`.
- Pick-and-set command flow: no `activeTextEditor` →
  `showWarningMessage('Open a todo file first')` (a distinct pre-guard
  message, deliberately preserved in 3a — NOT the canonical guard warning);
  then `requireTodoEditor` (canonical warning on non-todo docs); parse via
  the memoized `parseDocument`; QuickPick whose first entry is
  `$(circle-slash) Clear focus` (description "Show all ...", value
  `undefined`) followed by the definitions sorted case-insensitively
  (`localeCompare` with `sensitivity: 'base'`); when the definitions list
  is empty an information message fires (not awaited) and the QuickPick
  still opens with just the Clear entry; placeholder is
  `Currently focused on <token>` when set, else
  `Select a <noun> to focus on (or clear)`; options are
  `matchOnDescription: true, matchOnDetail: true` in **all three** pickers;
  Esc/cancel → return with no side effects.
- Side effects on set AND clear, in exact order: (1) workspaceState write,
  (2) dim repaint in every **visible editor that is a todo file** — the
  repaint-ALL-visible-editors variant exists only in the tree context-menu
  handlers (`features/tree-commands.ts`, Appendix A) and is untouched by
  3d, (3) the dimension's own status-bar refresh against
  `window.activeTextEditor`. No tree refresh fires — the grouping trees do
  not filter by focus. Activity's `refreshAllActivityUI` is byte-equivalent
  to steps (2)+(3).
- State access via `state.ts`'s module-level `ExtensionContext` singleton;
  setters silently no-op when the context was never set.

### Intentional divergences across the four dimensions (descriptor fields)

| #   | Axis                               | User                                                                                                            | Tag                                                                                         | Project                                                                                              | Activity                                                                                                                                              |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | workspaceState key/type            | `mdTodo.focusUser` (string)                                                                                     | `mdTodo.focusTag` (string)                                                                  | `mdTodo.focusProject` (string)                                                                       | `mdTodo.activityFocus` (`ActivityFocus` object)                                                                                                       |
| B2  | Status-bar priority                | 100                                                                                                             | 99                                                                                          | 97                                                                                                   | 98 — all Right-aligned, so on-screen left-to-right is **user, tag, activity, project** (descending priority); priorities are frozen descriptor inputs |
| B3  | Status-bar click command           | `mdTodo.setFocusUser`                                                                                           | `mdTodo.setFocusTag`                                                                        | `mdTodo.setFocusProject`                                                                             | `mdTodo.activityFocusMenu` (an external command menu, not an engine pick; `mdTodo.setFocusActivity` is a registered alias)                            |
| B4  | Icon                               | `$(person)`                                                                                                     | `$(tag)`                                                                                    | `$(project)`                                                                                         | `$(calendar)`                                                                                                                                         |
| B5  | Unset text                         | `All users`                                                                                                     | `All tags`                                                                                  | `All projects`                                                                                       | `All time`                                                                                                                                            |
| B6  | Unset tooltip                      | `No user focus — click to focus on a user`                                                                      | `No tag focus — click to focus on a tag`                                                    | `No project focus — click to focus on a project`                                                     | `No activity focus — click to filter by date`                                                                                                         |
| B7  | Set text token                     | `@<focus>`                                                                                                      | `#<focus>`                                                                                  | `[<focus>]`                                                                                          | `<Prefix>: <label>`, Prefix ∈ Completed \| Added \| Stale                                                                                             |
| B8  | Set tooltip                        | parses the ACTIVE document on every refresh to resolve `Focused on <fullname \|\| shortname> — click to change` | `Focused on #<focus> — click to change`                                                     | `Focused on [<focus>] — click to change`                                                             | `Activity focus: <Prefix> (<label>) — click to change`                                                                                                |
| B9  | Pick source + entry                | `userDefinitions` sorted by shortname; label `$(person) @<short>`, description fullname, detail description     | `tagDefinitions` sorted by name; label `$(tag) #<name>`, no description, detail description | `projectDefinitions` sorted by name; label `$(project) <name>` (no `[]` wrapper), detail description | — (no definitions pick; focus is set by the report commands, which build an `ActivityFocus` from `pickDateRange`/`pickStaleThreshold`)                |
| B10 | No-defs info message               | `No users defined. Add a "## Users" section first.`                                                             | `No tags defined. Add a "## Tags" section first.`                                           | `No projects defined. Add a "## Projects" section first.`                                            | —                                                                                                                                                     |
| B11 | Pick placeholders                  | `Currently focused on @<x>` / `Select a user to focus on (or clear)`                                            | `Currently focused on #<x>` / `Select a tag to focus on (or clear)`                         | `Currently focused on [<x>]` / `Select a project to focus on (or clear)`                             | —                                                                                                                                                     |
| B12 | 'Open a todo file first' pre-guard | yes (pick command)                                                                                              | yes                                                                                         | yes                                                                                                  | not needed — the report commands are `registerTextEditorCommand` (never fire without an editor) and go through `requireTodoEditor` only               |
| B13 | Clear surface                      | no per-dimension command; `clearFocusUser` reached only via `mdTodo.clearAllFocus`                              | same                                                                                        | same                                                                                                 | dedicated `mdTodo.clearActivityFocus` command (also first entry of the activity menu)                                                                 |
| B14 | Bespoke extras                     | —                                                                                                               | —                                                                                           | —                                                                                                    | `activityFocusMenu` (4-entry command QuickPick, placeholder `Activity focus`) + the three report commands and their renderers → `features/reports/`   |

### Accidental divergences

None found — unlike 3c (row U1) the four modules' non-tree set/clear paths
are byte-equivalent modulo the descriptor fields above. Phase 3d targets
**zero behavior change**.
