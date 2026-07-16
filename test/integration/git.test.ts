import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * F-08: git access goes through execFile — every argument (notably the file
 * path) is passed verbatim as ONE argv element with no shell in between, so
 * paths containing spaces, `$`, backticks, or quotes can neither break the
 * command nor be shell-expanded.
 */

interface RecordedCall {
    file: string;
    args: readonly string[];
    options: { cwd?: string };
}
const calls = vi.hoisted(() => [] as RecordedCall[]);

vi.mock('child_process', () => {
    // promisify(execFile) resolves through this well-known symbol; providing
    // it lets the mock return the real { stdout, stderr } object shape.
    const custom = Symbol.for('nodejs.util.promisify.custom');
    const execFile = Object.assign(
        () => {
            throw new Error('vitest child_process mock: only the promisified form is stubbed');
        },
        {
            [custom]: (file: string, args: readonly string[], options: { cwd?: string }) => {
                calls.push({ file, args, options });
                return Promise.resolve({ stdout: 'MOCK_STDOUT', stderr: '' });
            },
        }
    );
    return { execFile };
});

import { logForFile, showCommit } from '../../src/vscode/git';

const NASTY_PATH = 'C:\\work\\my todos\\plan $HOME `rm -rf` "quoted".md';

describe('vscode/git (F-08)', () => {
    beforeEach(() => {
        calls.length = 0;
    });

    it('logForFile invokes git via argv — the nasty path is one verbatim argument', async () => {
        const out = await logForFile('C:\\work', NASTY_PATH, 20);
        expect(out).toBe('MOCK_STDOUT');
        expect(calls).toHaveLength(1);
        expect(calls[0].file).toBe('git');
        expect(calls[0].args).toEqual(['log', '--oneline', '--follow', '-20', '--', NASTY_PATH]);
        expect(calls[0].options.cwd).toBe('C:\\work');
    });

    it('showCommit invokes git show with an empty --format= and the verbatim path', async () => {
        const out = await showCommit('C:\\work', 'abc1234', NASTY_PATH);
        expect(out).toBe('MOCK_STDOUT');
        expect(calls).toHaveLength(1);
        expect(calls[0].file).toBe('git');
        expect(calls[0].args).toEqual(['show', 'abc1234', '--format=', '--', NASTY_PATH]);
        expect(calls[0].options.cwd).toBe('C:\\work');
    });
});
