import type { EvaluationProgress } from './runner.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const DEFAULT_REFRESH_MS = 100;

export interface ProgressOutput {
  readonly isTTY?: boolean;
  readonly columns?: number;
  write(chunk: string): unknown;
}

export interface ConsoleProgressOptions {
  readonly output?: ProgressOutput;
  readonly refreshMs?: number;
  readonly now?: () => number;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.ceil(durationMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${String(remainingSeconds).padStart(2, '0')}s`;
}

function percentage(completed: number, total: number): number {
  if (total === 0) return 100;
  return Math.floor((completed / total) * 100);
}

function phaseLabel(progress: EvaluationProgress, elapsedMs: number): string {
  switch (progress.phase) {
    case 'preparing':
      return 'préparation';
    case 'analyzing':
      return `analyse${progress.attempt === undefined ? '' : ` · tentative ${progress.attempt}/${progress.maxAttempts}`}`
        + ` · ${formatDuration(elapsedMs)}`;
    case 'waiting_rate_limit': {
      const remainingMs = Math.max(0, (progress.waitMs ?? 0) - elapsedMs);
      return `attente rate limit · reprise dans ${formatDuration(remainingMs)}`;
    }
    case 'waiting_delay': {
      const remainingMs = Math.max(0, (progress.waitMs ?? 0) - elapsedMs);
      return `pause · prochain cas dans ${formatDuration(remainingMs)}`;
    }
    case 'case_completed':
      return progress.status?.replaceAll('_', ' ') ?? 'cas terminé';
    case 'completed':
      return 'terminé';
  }
}

export class ConsoleEvaluationProgress {
  private readonly output: ProgressOutput;
  private readonly refreshMs: number;
  private readonly now: () => number;
  private progress: EvaluationProgress | undefined;
  private updatedAt = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastNonTtyCompleted = -1;

  constructor(options: ConsoleProgressOptions = {}) {
    this.output = options.output ?? process.stdout;
    this.refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
    this.now = options.now ?? Date.now;
  }

  update(progress: EvaluationProgress): void {
    this.progress = progress;
    this.updatedAt = this.now();
    this.render();
    if (this.output.isTTY === true && this.timer === undefined && progress.phase !== 'completed') {
      this.timer = setInterval(() => this.render(), this.refreshMs);
      this.timer.unref?.();
    }
  }

  finish(): void {
    this.stopTimer();
    if (this.progress !== undefined) this.render(true);
    this.output.write('\n');
  }

  stop(): void {
    this.stopTimer();
    if (this.output.isTTY === true) this.output.write('\n');
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private render(force = false): void {
    const progress = this.progress;
    if (progress === undefined) return;
    if (this.output.isTTY !== true) {
      if (!force && progress.completed === this.lastNonTtyCompleted) return;
      this.lastNonTtyCompleted = progress.completed;
    }

    const done = progress.phase === 'completed';
    const marker = done ? '✔' : SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
    this.frame += 1;
    const current = progress.currentId === undefined ? '' : ` · ${progress.currentId}`;
    const elapsedMs = this.now() - this.updatedAt;
    const line = `${marker} ${String(percentage(progress.completed, progress.total)).padStart(3, ' ')}%`
      + ` · ${progress.completed}/${progress.total}${current} · ${phaseLabel(progress, elapsedMs)}`;
    const width = Math.max(20, (this.output.columns ?? 120) - 1);
    const visibleLine = line.length > width ? `${line.slice(0, width - 1)}…` : line;
    this.output.write(this.output.isTTY === true ? `\u001B[2K\r${visibleLine}` : `${visibleLine}\n`);
  }
}
