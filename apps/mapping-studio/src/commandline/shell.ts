/** Terminal-style commands over the workspace folder. Pure apart from the FilePort it is given. Paths never leave the root. */
import type { FilePort } from '@mms/workspace-files';
import { tokenize } from './commands.js';

export type Cwd = readonly string[];

export const SHELL_COMMANDS = ['pwd', 'ls', 'cd', 'cat', 'tree', 'mkdir', 'touch', 'cp', 'mv', 'rm'] as const;

export const isShellCommand = (name: string): boolean =>
  (SHELL_COMMANDS as readonly string[]).includes(name);

export const formatPath = (cwd: Cwd): string => '/' + cwd.join('/');

/** Resolves a typed path against the current folder. ".." at the root stays at the root. */
export function resolvePath(cwd: Cwd, typed: string): string[] {
  const out: string[] = typed.startsWith('/') ? [] : [...cwd];
  for (const part of typed.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

async function isDir(port: FilePort, path: readonly string[]): Promise<boolean> {
  if (path.length === 0) return true;
  const parent = await port.list(path.slice(0, -1));
  return parent.some((e) => e.name === path[path.length - 1] && e.kind === 'dir');
}

async function exists(port: FilePort, path: readonly string[]): Promise<boolean> {
  if (path.length === 0) return true;
  const parent = await port.list(path.slice(0, -1));
  return parent.some((e) => e.name === path[path.length - 1]);
}

async function copyTree(port: FilePort, from: readonly string[], to: readonly string[]): Promise<void> {
  if (await isDir(port, from)) {
    for (const e of await port.list(from)) await copyTree(port, [...from, e.name], [...to, e.name]);
    return;
  }
  const bytes = await port.readBytes(from);
  if (bytes) await port.writeBytes(to, bytes);
}

async function tree(port: FilePort, path: readonly string[], prefix: string, depth: number): Promise<string[]> {
  if (depth > 4) return [];
  const out: string[] = [];
  const entries = (await port.list(path)).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    out.push(`${prefix}${e.name}${e.kind === 'dir' ? '/' : ''}`);
    if (e.kind === 'dir') out.push(...(await tree(port, [...path, e.name], prefix + '  ', depth + 1)));
  }
  return out;
}

const MAX_CAT = 20000;

export interface ShellResult {
  lines: string[];
  cwd: Cwd;
}

/** Runs one shell line. Never throws: errors come back as lines. */
export async function runShell(line: string, cwd: Cwd, port: FilePort): Promise<ShellResult> {
  const [name, ...rest] = tokenize(line.trim());
  const yes = rest.includes('--yes');
  const args = rest.filter((a) => a !== '--yes');
  const at = (i: number): string[] | undefined => (args[i] === undefined ? undefined : resolvePath(cwd, args[i]));
  const done = (lines: string[], next: Cwd = cwd): ShellResult => ({ lines, cwd: next });
  try {
    switch (name) {
      case 'pwd':
        return done([formatPath(cwd)]);
      case 'ls': {
        const p = at(0) ?? [...cwd];
        if (!(await exists(port, p))) return done([`ls: no such folder: ${formatPath(p)}`]);
        if (!(await isDir(port, p))) return done([p[p.length - 1] ?? '']);
        const entries = (await port.list(p)).sort((a, b) => a.name.localeCompare(b.name));
        return done(entries.length ? entries.map((e) => e.name + (e.kind === 'dir' ? '/' : '')) : ['(empty)']);
      }
      case 'tree': {
        const p = at(0) ?? [...cwd];
        return done(await tree(port, p, '', 0));
      }
      case 'cd': {
        const p = at(0) ?? [];
        if (!(await isDir(port, p))) return done([`cd: no such folder: ${formatPath(p)}`]);
        return done([], p);
      }
      case 'cat': {
        const p = at(0);
        if (!p) return done(['Use: cat <file>']);
        const text = await port.readText(p);
        if (text === undefined) return done([`cat: cannot read: ${formatPath(p)}`]);
        const shown = text.length > MAX_CAT ? text.slice(0, MAX_CAT) + '\n... (cut)' : text;
        return done(shown.split('\n'));
      }
      case 'mkdir': {
        const p = at(0);
        if (!p || p.length === 0) return done(['Use: mkdir <folder>']);
        if (await exists(port, p)) return done([`mkdir: already exists: ${formatPath(p)}`]);
        await port.writeText([...p, '.keep'], '');
        return done([`Created ${formatPath(p)}`]);
      }
      case 'touch': {
        const p = at(0);
        if (!p || p.length === 0) return done(['Use: touch <file>']);
        if (await exists(port, p)) return done([`touch: already exists: ${formatPath(p)}`]);
        await port.writeText(p, '');
        return done([`Created ${formatPath(p)}`]);
      }
      case 'cp':
      case 'mv': {
        const from = at(0);
        const to = at(1);
        if (!from || !to || from.length === 0 || to.length === 0) return done([`Use: ${name} <from> <to>`]);
        if (!(await exists(port, from))) return done([`${name}: not found: ${formatPath(from)}`]);
        if (await exists(port, to)) return done([`${name}: target exists, nothing changed: ${formatPath(to)}`]);
        if (to.join('/').startsWith(from.join('/') + '/'))
          return done([`${name}: cannot move a folder into itself.`]);
        await copyTree(port, from, to);
        if (name === 'mv') await port.remove(from);
        return done([`${name === 'mv' ? 'Moved' : 'Copied'} ${formatPath(from)} to ${formatPath(to)}`]);
      }
      case 'rm': {
        const p = at(0);
        if (!p || p.length === 0) return done(['Use: rm <path> --yes']);
        if (!(await exists(port, p))) return done([`rm: not found: ${formatPath(p)}`]);
        if (!yes)
          return done([`This deletes ${formatPath(p)} for good (a folder with everything in it).`, `Run again to confirm: rm ${args[0]} --yes`]);
        await port.remove(p);
        const inside = p.length <= cwd.length && p.every((s, i) => cwd[i] === s);
        return done([`Deleted ${formatPath(p)}`], inside ? p.slice(0, -1) : cwd);
      }
      default:
        return done([`Unknown command: ${name}`]);
    }
  } catch (e) {
    return done([`${name}: ${e instanceof Error ? e.message : 'failed'}`]);
  }
}
