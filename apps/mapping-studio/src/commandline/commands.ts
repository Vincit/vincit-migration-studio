/** Command line for the studio. Pure: no React, no browser APIs. The UI hands in a context and prints the lines. */

export type StageId = 'sources' | 'target' | 'map' | 'test' | 'ready';
export const STAGE_IDS: readonly StageId[] = ['sources', 'target', 'map', 'test', 'ready'];

export interface SourceInfo {
  name: string;
  datasets: { name: string; fields: number; rows: number | undefined }[];
}
export interface TargetInfo {
  name: string;
  fields: number;
}
export interface DiagnosticInfo {
  severity: string;
  code: string;
  message: string;
}

export interface CommandContext {
  projectName: string;
  stage: StageId;
  sources: readonly SourceInfo[];
  targets: readonly TargetInfo[];
  mappingCount: number;
  diagnostics: readonly DiagnosticInfo[];
  /** Customer/object folders, when a workspace folder is open. Undefined in classic mode. */
  folders: readonly string[] | undefined;
  goto: (stage: StageId) => void;
  /** Opens the file picker of the Sources or Target stage. */
  pickFile: (kind: 'source' | 'target') => void;
  undo: () => boolean;
  saveProject: () => void;
}

export interface Command {
  name: string;
  usage: string;
  help: string;
  run: (args: string[], ctx: CommandContext) => string[];
}

/** Splits a line into words. Double quotes keep spaces together. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

function listSources(ctx: CommandContext): string[] {
  if (ctx.sources.length === 0) return ['No source files yet. Use: source add'];
  return ctx.sources.flatMap((s) =>
    s.datasets.map(
      (d) =>
        `${s.name} / ${d.name}: ${plural(d.fields, 'field')}, ${
          d.rows === undefined ? 'rows not loaded' : plural(d.rows, 'row')
        }`,
    ),
  );
}

function listTargets(ctx: CommandContext): string[] {
  if (ctx.targets.length === 0) return ['No target yet. Use: target set'];
  return ctx.targets.map((t) => `${t.name}: ${plural(t.fields, 'field')}`);
}

export const COMMANDS: readonly Command[] = [
  {
    name: 'help',
    usage: 'help [command]',
    help: 'List commands, or show one.',
    run: (args) => {
      const c = args[0] ? COMMANDS.find((x) => x.name === args[0]) : undefined;
      if (args[0] && !c) return [`Unknown command: ${args[0]}`];
      if (c) return [c.usage, c.help];
      return [
        ...COMMANDS.map((x) => `${x.usage.padEnd(24)} ${x.help}`),
        'Workspace folder (needs an open folder):',
        'pwd, ls [path], cd <path>, cat <file>, tree [path]',
        'mkdir <folder>, touch <file>, cp <from> <to>, mv <from> <to>, rm <path> --yes',
      ];
    },
  },
  {
    name: 'status',
    usage: 'status',
    help: 'Project, stage, sources, target, mappings, problems.',
    run: (_a, ctx) => {
      const errors = ctx.diagnostics.filter((d) => d.severity === 'error').length;
      return [
        `Project: ${ctx.projectName}`,
        `Stage: ${ctx.stage}`,
        `Sources: ${ctx.sources.length}, targets: ${ctx.targets.length}, mappings: ${ctx.mappingCount}`,
        `Problems: ${errors} error(s), ${ctx.diagnostics.length - errors} other`,
      ];
    },
  },
  {
    name: 'goto',
    usage: 'goto <stage>',
    help: `Go to a stage: ${STAGE_IDS.join(', ')}.`,
    run: (args, ctx) => {
      const s = STAGE_IDS.find((x) => x === args[0]);
      if (!s) return [`Pick one of: ${STAGE_IDS.join(', ')}`];
      ctx.goto(s);
      return [`Now on ${s}.`];
    },
  },
  {
    name: 'list',
    usage: 'list [sources|targets|folders]',
    help: 'List what the project holds (default: sources and targets).',
    run: (args, ctx) => {
      const what = args[0] ?? 'all';
      if (what === 'sources') return listSources(ctx);
      if (what === 'targets') return listTargets(ctx);
      if (what === 'folders')
        return ctx.folders ? [...ctx.folders] : ['No workspace folder open (classic mode).'];
      if (what === 'all') return ['Sources:', ...listSources(ctx), 'Targets:', ...listTargets(ctx)];
      return ['Use: list [sources|targets|folders]'];
    },
  },
  {
    name: 'source',
    usage: 'source add',
    help: 'Add source files: goes to Sources and opens the file picker.',
    run: (args, ctx) => {
      if (args[0] !== 'add') return ['Use: source add'];
      ctx.pickFile('source');
      return ['Choose the source files.'];
    },
  },
  {
    name: 'target',
    usage: 'target set',
    help: 'Set the target: goes to Target and opens the file picker.',
    run: (args, ctx) => {
      if (args[0] !== 'set') return ['Use: target set'];
      ctx.pickFile('target');
      return ['Choose the target file.'];
    },
  },
  {
    name: 'diag',
    usage: 'diag [error|warning|info]',
    help: 'Show problems found in the project, optionally by severity.',
    run: (args, ctx) => {
      const list = args[0] ? ctx.diagnostics.filter((d) => d.severity === args[0]) : ctx.diagnostics;
      if (list.length === 0) return ['No problems.'];
      return list.slice(0, 50).map((d) => `[${d.severity}] ${d.code}: ${d.message}`);
    },
  },
  {
    name: 'undo',
    usage: 'undo',
    help: 'Bring back the last deleted mappings.',
    run: (_a, ctx) => [ctx.undo() ? 'Restored.' : 'Nothing to undo.'],
  },
  {
    name: 'save',
    usage: 'save',
    help: 'Download the project file.',
    run: (_a, ctx) => {
      ctx.saveProject();
      return ['Project file offered for download.'];
    },
  },
  {
    name: 'clear',
    usage: 'clear',
    help: 'Clear the output.',
    run: () => [],
  },
];

/** Runs one line. Returns the lines to print. `clear` is handled by the caller. */
export function execute(line: string, ctx: CommandContext): string[] {
  const [name, ...args] = tokenize(line.trim());
  if (!name) return [];
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) return [`Unknown command: ${name}. Type help.`];
  return c.run(args, ctx);
}

/** Commands whose name starts with the typed text, for the suggestion list. */
export function suggest(text: string): Command[] {
  const t = text.trim().split(/\s+/)[0] ?? '';
  return COMMANDS.filter((c) => c.name.startsWith(t.toLowerCase()));
}
