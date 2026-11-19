import {
  Button,
  Dialog,
  DialogBody,
  DialogSurface,
  DialogTitle,
  tokens,
} from '@fluentui/react-components';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalStudio } from '../context';
import { useOptionalWorkspace } from '../workspace';
import {
  COMMANDS,
  STAGE_IDS,
  execute,
  suggest,
  tokenize,
  type CommandContext,
  type StageId,
} from './commands';
import { formatPath, isShellCommand, runShell, type Cwd } from './shell';

interface Entry {
  prompt: string;
  lines: string[];
}

const INPUT_FOR: Record<'source' | 'target', { stage: StageId; testId: string }> = {
  source: { stage: 'sources', testId: 'source-files-input' },
  target: { stage: 'target', testId: 'target-file-input' },
};

/** Cmd/Ctrl+K opens a terminal-style command line: studio commands plus pwd/ls/cd/cat/mkdir/cp/mv/rm on the workspace folder. */
export function CommandLine() {
  const studio = useOptionalStudio();
  const workspace = useOptionalWorkspace();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [cwd, setCwd] = useState<Cwd>([]);
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const cursor = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [log, open]);

  const state = studio?.state;
  const stage: StageId = studio?.stage ?? 'sources';
  const setStage = studio?.setStage;
  const preflight = studio?.preflight;
  const lastDeleted = studio?.lastDeleted;
  const undoDelete = studio?.undoDelete;
  const saveProjectFile = studio?.saveProjectFile;
  const ctx = useMemo<CommandContext>(
    () => ({
      projectName: state?.project.name ?? '(no project open)',
      stage,
      sources: (state?.project.sourceDefinitions ?? []).map((s) => ({
        name: s.name,
        datasets: s.datasets.map((d) => ({
          name: d.name,
          fields: d.fields.length,
          rows: state?.data[d.id]?.rows.length,
        })),
      })),
      targets: (state?.project.targetDefinition?.structures ?? []).map((t) => ({
        name: t.name,
        fields: t.fields.length,
      })),
      mappingCount: state?.project.mappingDefinition?.mappings.length ?? 0,
      diagnostics: (preflight ?? []).map((d) => ({
        severity: d.severity,
        code: d.code,
        message: d.message,
      })),
      folders: workspace ? workspace.customers.map((c) => c.folder) : undefined,
      goto: (s) => setStage?.(s),
      pickFile: (kind) => {
        if (!setStage) return;
        const { stage: to, testId } = INPUT_FOR[kind];
        setStage(to);
        setOpen(false);
        // The stage needs a moment to draw its file input.
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)?.click();
        }, 150);
      },
      undo: () => {
        if (!lastDeleted || !undoDelete) return false;
        undoDelete();
        return true;
      },
      saveProject: () => saveProjectFile?.(),
    }),
    [state, stage, setStage, preflight, workspace, lastDeleted, undoDelete, saveProjectFile],
  );

  const submit = useCallback(async () => {
    const line = text.trim();
    if (!line || busy) return;
    const prompt = `${formatPath(cwd)} $ ${line}`;
    history.current.push(line);
    cursor.current = history.current.length;
    setText('');
    const name = tokenize(line)[0] ?? '';
    if (name === 'clear') {
      setLog([]);
      return;
    }
    if (isShellCommand(name)) {
      const port = workspace?.getPort();
      if (!port) {
        setLog((l) => [
          ...l,
          {
            prompt,
            lines: ['No workspace folder is open. Choose a folder on the home page first.'],
          },
        ]);
        return;
      }
      setBusy(true);
      const r = await runShell(line, cwd, port);
      setBusy(false);
      setCwd(r.cwd);
      setLog((l) => [...l, { prompt, lines: r.lines }]);
      return;
    }
    setLog((l) => [...l, { prompt, lines: execute(line, ctx) }]);
  }, [text, busy, cwd, workspace, ctx]);

  const hints = text.trim() ? suggest(text) : [];

  return (
    <>
      <Button
        data-testid="command-line-button"
        appearance="primary"
        size="small"
        aria-label="Open command line"
        title="Command line (Ctrl/Cmd+K)"
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 1000 }}
      >
        &gt;_ Command line
      </Button>
      <Dialog open={open} onOpenChange={(_e, d) => setOpen(d.open)}>
        <DialogSurface
          aria-label="Command line"
          data-testid="command-line"
          style={{ maxWidth: 720, width: '92vw' }}
        >
          <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DialogTitle>Command line</DialogTitle>
            <div
              data-testid="command-output"
              style={{
                fontFamily: tokens.fontFamilyMonospace,
                fontSize: 13,
                minHeight: 200,
                maxHeight: '45vh',
                overflow: 'auto',
                background: tokens.colorNeutralBackground3,
                padding: 8,
                borderRadius: 4,
                whiteSpace: 'pre-wrap',
              }}
            >
              {log.length === 0 && (
                <div style={{ color: tokens.colorNeutralForeground3 }}>
                  Type help. Folder commands: pwd, ls, cd, cat, tree, mkdir, touch, cp, mv, rm.
                </div>
              )}
              {log.map((e, i) => (
                <div key={i}>
                  <div style={{ color: tokens.colorBrandForeground1 }}>{e.prompt}</div>
                  {e.lines.map((l, j) => (
                    <div key={j}>{l}</div>
                  ))}
                </div>
              ))}
              <div ref={bottom} />
            </div>
            {hints.length > 0 && hints.length < COMMANDS.length && (
              <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>
                {hints.map((h) => h.usage).join('   ')}
              </div>
            )}
            <input
              autoFocus
              data-testid="command-input"
              aria-label="Command"
              placeholder={`${formatPath(cwd)} $`}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                else if (e.key === 'ArrowUp' && history.current.length > 0) {
                  e.preventDefault();
                  cursor.current = Math.max(0, cursor.current - 1);
                  setText(history.current[cursor.current] ?? '');
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  cursor.current = Math.min(history.current.length, cursor.current + 1);
                  setText(history.current[cursor.current] ?? '');
                }
              }}
              style={{
                fontFamily: tokens.fontFamilyMonospace,
                fontSize: 14,
                padding: 8,
                border: `1px solid ${tokens.colorNeutralStroke1}`,
                borderRadius: 4,
                background: tokens.colorNeutralBackground1,
                color: tokens.colorNeutralForeground1,
              }}
            />
            <div style={{ fontSize: 12, color: tokens.colorNeutralForeground3 }}>
              Stages: {STAGE_IDS.join(', ')}. Ctrl/Cmd+K toggles. Up/Down for history.
            </div>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
