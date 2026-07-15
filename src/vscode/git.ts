import { execFile } from 'child_process';
import { promisify } from 'util';

/**
 * execFile-based git access (F-08). The old history command built shell
 * strings — `exec('git log ... -- "${filePath}"')` — so a path containing
 * `` ` ``, `$`, or quotes broke the command or was shell-expanded. execFile
 * passes each argument verbatim with no shell in between; paths with spaces
 * and metacharacters need (and get) no quoting at all.
 *
 * This module is the only place in src/ allowed to touch child_process.
 */
const execFileAsync = promisify(execFile);

/** `git log --oneline --follow -<limit> -- <filePath>` in `cwd`; returns stdout. */
export async function logForFile(cwd: string, filePath: string, limit: number): Promise<string> {
    const { stdout } = await execFileAsync(
        'git',
        ['log', '--oneline', '--follow', `-${limit}`, '--', filePath],
        { cwd }
    );
    return stdout;
}

/** `git show <hash> --format= -- <filePath>` in `cwd`; returns the diff text. */
export async function showCommit(cwd: string, hash: string, filePath: string): Promise<string> {
    const { stdout } = await execFileAsync('git', ['show', hash, '--format=', '--', filePath], {
        cwd,
    });
    return stdout;
}
