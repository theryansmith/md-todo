/**
 * Engine-level tests for GroupingTreeProvider lifecycle behavior that the
 * characterization suite (grouping-trees.test.ts) does not cover: the 200 ms
 * debounced refresh and the Phase 3c fix that dispose() cancels a pending
 * debounce timer (the pre-3c providers leaked theirs — see the Requirements
 * Checklist note in the TDD).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GroupingTreeProvider } from '../../src/vscode/grouping-tree';
import { usersGrouping } from '../../src/features/users/tree-users';

function makeMemento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
        get: (key: string) => store.get(key),
        update: (key: string, value: unknown) => {
            store.set(key, value);
            return Promise.resolve();
        },
        keys: () => [...store.keys()],
    };
}

describe('GroupingTreeProvider refresh lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires refresh() immediately', () => {
        const provider = new GroupingTreeProvider(usersGrouping, makeMemento());
        let fired = 0;
        provider.onDidChangeTreeData(() => {
            fired++;
        });
        provider.refresh();
        expect(fired).toBe(1);
    });

    it('coalesces refreshDebounced() calls into one event after 200 ms', () => {
        const provider = new GroupingTreeProvider(usersGrouping, makeMemento());
        let fired = 0;
        provider.onDidChangeTreeData(() => {
            fired++;
        });
        provider.refreshDebounced();
        provider.refreshDebounced();
        provider.refreshDebounced();
        expect(fired).toBe(0);
        vi.advanceTimersByTime(199);
        expect(fired).toBe(0);
        vi.advanceTimersByTime(1);
        expect(fired).toBe(1);
        vi.advanceTimersByTime(1000);
        expect(fired).toBe(1);
    });

    it('dispose() cancels a pending debounced refresh — no timer leaks', () => {
        const provider = new GroupingTreeProvider(usersGrouping, makeMemento());
        let fired = 0;
        provider.onDidChangeTreeData(() => {
            fired++;
        });
        provider.refreshDebounced();
        expect(vi.getTimerCount()).toBe(1);
        provider.dispose();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(1000);
        expect(fired).toBe(0);
    });
});
