import * as vscode from 'vscode';
import { SuggestionItem } from './types';
import { parseDocument, validateTags } from './parser';

export async function addTagDefinition(editor: vscode.TextEditor, name: string, description: string) {
    const document = editor.document;
    const parsed = parseDocument(document);
    const tagsSection = parsed.sections.get('tags');

    const newLine = `**${name}**: ${description}`;

    if (tagsSection) {
        let insertLine = tagsSection.start + 1;
        while (insertLine < document.lineCount && document.lineAt(insertLine).text.trim() === '') {
            insertLine++;
        }

        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.insert(new vscode.Position(insertLine, 0), newLine + '\n');
        });
    } else {
        const insertLine = document.lineCount;

        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const text = `\n## Tags\n\n${newLine}\n`;
            editBuilder.insert(new vscode.Position(insertLine, 0), text);
        });
    }

    vscode.window.showInformationMessage(`Added tag: #${name}`);
}

export async function addUserDefinition(editor: vscode.TextEditor, shortname: string, newLine: string) {
    const document = editor.document;
    const parsed = parseDocument(document);
    const usersSection = parsed.sections.get('users');

    if (usersSection) {
        let insertLine = usersSection.start + 1;
        while (insertLine < document.lineCount && document.lineAt(insertLine).text.trim() === '') {
            insertLine++;
        }
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            editBuilder.insert(new vscode.Position(insertLine, 0), newLine + '\n');
        });
    } else {
        const insertLine = document.lineCount;
        await editor.edit((editBuilder: vscode.TextEditorEdit) => {
            const text = `\n## Users\n\n${newLine}\n`;
            editBuilder.insert(new vscode.Position(insertLine, 0), text);
        });
    }

    vscode.window.showInformationMessage(`Added user: @${shortname}`);
}

export async function promptCreateTags(editor: vscode.TextEditor, undefinedTags: string[]): Promise<string[]> {
    const createdTags: string[] = [];

    for (const tagName of undefinedTags) {
        const choice = await vscode.window.showQuickPick(
            ['Yes, create it', 'No, skip this tag', 'Cancel all'],
            { placeHolder: `Tag '${tagName}' doesn't exist. Create it?` }
        );

        if (choice === 'Cancel all') { return []; }
        if (choice === 'Yes, create it') {
            const description = await vscode.window.showInputBox({
                prompt: `Enter description for #${tagName}`,
                placeHolder: 'Tag description'
            });
            if (description !== undefined) {
                await addTagDefinition(editor, tagName, description || 'No description');
                createdTags.push(tagName);
            }
        }
    }
    return createdTags;
}

export async function processTagsWithValidation(editor: vscode.TextEditor, inputTags: string[]): Promise<string[] | null> {
    const parsed = parseDocument(editor.document);
    const validation = validateTags(inputTags, parsed.tagDefinitions);

    if (validation.undefinedTags.length === 0) { return inputTags; }

    const createdTags = await promptCreateTags(editor, validation.undefinedTags);
    return [...validation.validTags, ...createdTags];
}

/**
 * Filter `defs` by case-insensitive substring of `partial` over the text
 * returned by `searchable`, sort the matches alphabetically by `sortKey`
 * (case-insensitive via localeCompare with sensitivity: 'base'), then map to
 * SuggestionItems via `toItem`. The sort here is belt-and-braces: parseDocument
 * already pre-sorts userDefinitions and tagDefinitions at the source, but
 * keeping the comparator visible at the consumer site documents the contract
 * and survives future refactors of parseDocument.
 */
export function sortedSuggestions<T>(
    defs: readonly T[],
    partial: string,
    searchable: (d: T) => string,
    sortKey: (d: T) => string,
    toItem: (d: T) => SuggestionItem,
): SuggestionItem[] {
    return defs
        .filter(d => searchable(d).toLowerCase().includes(partial))
        .slice()
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base' }))
        .map(toItem);
}

/**
 * Prompt the user for free-form todo / note text with inline @user / #tag
 * suggestions. As the user types an `@xxx` or `#xxx` token at the end of the
 * value, matching users / tags from the document populate the picker. Selecting
 * one inserts it into the value and keeps the picker open. Pressing Enter with
 * no item highlighted submits the value as the result.
 */
export function promptForTodoText(
    document: vscode.TextDocument,
    options: { prompt: string; placeHolder: string }
): Promise<string | undefined> {
    const parsed = parseDocument(document);

    return new Promise<string | undefined>(resolve => {
        const qp = vscode.window.createQuickPick<SuggestionItem>();
        qp.title = options.prompt;
        qp.placeholder = options.placeHolder;
        // We do all of our own filtering and sorting in refreshSuggestions /
        // sortedSuggestions, and hand qp.items a list that is already in the
        // exact order we want shown. To make VS Code respect that order we
        // have to neutralise THREE separate built-in QuickPick behaviours:
        //
        //  1. matchOnDescription / matchOnDetail (public API, default false):
        //     when on, VS Code also fuzzy-matches the typed value against
        //     description/detail and folds those scores into ordering. We
        //     leave these off (their default) so only the label is considered.
        //
        //  2. matchOnLabel (internal, default true): VS Code always runs its
        //     fuzzy scorer against `label`. There is no way to disable this
        //     through the public @types/vscode QuickPick interface. We turn
        //     it off via an `as any` cast so the scorer never runs at all,
        //     leaving ordering up to us. Manual filtering (sortedSuggestions)
        //     plus `alwaysShow: true` on every item means nothing gets
        //     dropped or reordered behind our back.
        //
        //  3. sortByLabel (internal, default true): even when the scores are
        //     equal, VS Code applies its own label sort on top — and for
        //     single-character inputs like '@' or '#' the score the matcher
        //     produces is NOT equal across items. The scorer is biased by
        //     label length / word-boundary heuristics, so '@bob' (4 chars)
        //     scores differently from '@charlie' (8 chars) for input '@'.
        //     The visible result is a not-quite-alphabetical, not-quite-
        //     source order — the exact "random-looking" order users report.
        //     Setting sortByLabel = false tells VS Code to preserve the
        //     insertion order of qp.items rather than re-sorting by score.
        //
        // Documented at microsoft/vscode#73904 ("Add option to skip sorting
        // QuickPick items"). sortByLabel has been a stable internal field
        // for years and is the established escape hatch for extensions that
        // pre-sort their own items; @types/vscode just doesn't expose it.
        //
        // v1.4.1 only set matchOnDescription / matchOnDetail (1), which left
        // the actual culprit — label scoring (2) and the re-sort that
        // follows (3) — untouched, so first-character '@' / '#' still
        // produced reordered results.
        qp.matchOnDescription = false;
        qp.matchOnDetail = false;
        (qp as unknown as { matchOnLabel: boolean }).matchOnLabel = false;
        (qp as unknown as { sortByLabel: boolean }).sortByLabel = false;
        qp.ignoreFocusOut = true;

        let resolved = false;
        const finish = (result: string | undefined) => {
            if (resolved) { return; }
            resolved = true;
            resolve(result);
            qp.hide();
        };

        const refreshSuggestions = (value: string) => {
            const tokenMatch = value.match(/([@#])([\w-]*)$/);
            if (!tokenMatch) {
                qp.items = [];
                qp.activeItems = [];
                return;
            }
            const trigger = tokenMatch[1];
            const partial = tokenMatch[2].toLowerCase();
            let items: SuggestionItem[] = [];
            if (trigger === '@') {
                items = sortedSuggestions(parsed.userDefinitions, partial,
                    u => `${u.shortname} ${u.fullname} ${u.description}`,
                    u => u.shortname,
                    u => ({
                        label: `@${u.shortname}`,
                        description: u.fullname,
                        detail: u.description,
                        insertText: `@${u.shortname}`,
                        alwaysShow: true,
                    }));
            } else {
                items = sortedSuggestions(parsed.tagDefinitions, partial,
                    t => `${t.name} ${t.description}`,
                    t => t.name,
                    t => ({
                        label: `#${t.name}`,
                        description: t.description,
                        detail: '',
                        insertText: `#${t.name}`,
                        alwaysShow: true,
                    }));
            }
            qp.items = items;
            qp.activeItems = [];
        };

        qp.onDidChangeValue(refreshSuggestions);

        qp.onDidAccept(() => {
            const active = qp.activeItems[0];
            if (active) {
                const newValue = qp.value.replace(/([@#])([\w-]*)$/, `${active.insertText} `);
                qp.value = newValue;
                qp.items = [];
                qp.activeItems = [];
                return;
            }
            finish(qp.value || undefined);
        });

        qp.onDidHide(() => {
            finish(undefined);
            qp.dispose();
        });

        qp.show();
    });
}
