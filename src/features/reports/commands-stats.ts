import * as vscode from 'vscode';
import { isTodoFile, parseDocument } from '../../vscode/document-cache';
import { getEffectiveEditor } from '../../vscode/editor-queries';
import { parseDate, daysBetween } from '../../core/dates';

export async function showStats(editor: vscode.TextEditor) {
    const ctx = await getEffectiveEditor(editor);
    const effectiveDocument = ctx.document;

    if (!isTodoFile(effectiveDocument)) {
        vscode.window.showWarningMessage(
            'Not a todo file. Add "md-todo: true" to YAML frontmatter.'
        );
        return;
    }

    const parsed = parseDocument(effectiveDocument);
    const today = new Date();

    const completed = parsed.items.filter((i) => i.isComplete);
    const incomplete = parsed.items.filter((i) => !i.isComplete);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const completedThisWeek = completed.filter((item) => {
        if (!item.completedDate) {
            return false;
        }
        const d = parseDate(item.completedDate);
        return d && d >= weekAgo;
    });

    const completionTimes: number[] = [];
    for (const item of completed) {
        if (item.addedDate && item.completedDate) {
            const added = parseDate(item.addedDate);
            const done = parseDate(item.completedDate);
            if (added && done) {
                completionTimes.push(daysBetween(added, done));
            }
        }
    }
    const avgCompletion =
        completionTimes.length > 0
            ? (completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length).toFixed(1)
            : 'N/A';

    const oldestIncomplete = incomplete
        .filter((i) => i.addedDate)
        .sort((a, b) => {
            const da = parseDate(a.addedDate!);
            const db = parseDate(b.addedDate!);
            if (!da || !db) {
                return 0;
            }
            return da.getTime() - db.getTime();
        })
        .slice(0, 5);

    const statsLines = [
        `# 📊 Todo Stats`,
        ``,
        `## Overview`,
        `- **Total items:** ${parsed.items.length}`,
        `- **Completed:** ${completed.length}`,
        `- **Incomplete:** ${incomplete.length}`,
        ``,
        `## Velocity`,
        `- **Completed this week:** ${completedThisWeek.length}`,
        `- **Avg completion time:** ${avgCompletion} days`,
        ``,
        `## Oldest Open Items`,
    ];

    for (const item of oldestIncomplete) {
        const age = item.addedDate
            ? `${daysBetween(today, parseDate(item.addedDate)!)} days old`
            : 'unknown age';
        statsLines.push(`- ${item.text} (${age})`);
    }

    if (oldestIncomplete.length === 0) {
        statsLines.push(`- No dated incomplete items`);
    }

    const doc = await vscode.workspace.openTextDocument({
        content: statsLines.join('\n'),
        language: 'markdown',
    });

    await vscode.window.showTextDocument(doc, {
        preview: true,
        viewColumn: vscode.ViewColumn.Beside,
    });
}
