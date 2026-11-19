import { describe, expect, it } from 'vitest';
import { MemoryPort } from '../../../packages/workspace-files/test/memory-port.js';
import { execute, tokenize, type CommandContext } from '../../../apps/mapping-studio/src/commandline/commands.js';
import { resolvePath, runShell } from '../../../apps/mapping-studio/src/commandline/shell.js';

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  projectName: 'P',
  stage: 'sources',
  sources: [],
  targets: [],
  mappingCount: 0,
  diagnostics: [],
  folders: undefined,
  goto: () => undefined,
  pickFile: () => undefined,
  undo: () => false,
  saveProject: () => undefined,
  ...over,
});

describe('M19 command line', () => {
  it('M19-01 tokenize keeps quoted words together', () => {
    expect(tokenize('cp "a b" c')).toEqual(['cp', 'a b', 'c']);
  });

  it('M19-02 paths never leave the root', () => {
    expect(resolvePath([], '../../x')).toEqual(['x']);
    expect(resolvePath(['a', 'b'], '../c')).toEqual(['a', 'c']);
    expect(resolvePath(['a'], '/z')).toEqual(['z']);
  });

  it('M19-03 shell: mkdir, touch, cd, ls, cp, mv, rm needs --yes', async () => {
    const port = new MemoryPort();
    let cwd: readonly string[] = [];
    const run = async (l: string): Promise<string[]> => {
      const r = await runShell(l, cwd, port);
      cwd = r.cwd;
      return r.lines;
    };
    await run('mkdir Acme');
    await run('cd Acme');
    expect(await run('pwd')).toEqual(['/Acme']);
    await run('touch a.txt');
    expect(await run('ls')).toContain('a.txt');
    await run('cp a.txt b.txt');
    await run('mv b.txt c.txt');
    const ls = await run('ls');
    expect(ls).toContain('c.txt');
    expect(ls).not.toContain('b.txt');
    expect((await run('rm c.txt'))[0]).toMatch(/deletes/);
    expect(await run('ls')).toContain('c.txt');
    await run('rm c.txt --yes');
    expect(await run('ls')).not.toContain('c.txt');
    expect((await run('cd nope'))[0]).toMatch(/no such folder/);
  });

  it('M19-04 studio commands', () => {
    expect(execute('nope', ctx())[0]).toMatch(/Unknown command/);
    expect(execute('status', ctx())).toContain('Project: P');
    let to = '';
    execute('goto map', ctx({ goto: (s: string) => (to = s) }));
    expect(to).toBe('map');
    expect(execute('diag', ctx())).toEqual(['No problems.']);
  });
});
