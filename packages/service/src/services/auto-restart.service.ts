import type { FrontendSettings } from '../types/index.js';

export type AutoRestartFault = {
  key: string;
  reason: string;
  portId?: string;
};

export type AutoRestartSettings = NonNullable<FrontendSettings['autoRestart']>;

export type AutoRestartServiceOptions = {
  loadSettings: () => Promise<FrontendSettings> | FrontendSettings;
  recoverFault?: (fault: AutoRestartFault) => Promise<boolean> | boolean;
  triggerRestart: () => Promise<void> | void;
  restartProcess: () => void;
  maxBridgeRecoveryAttempts?: number;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

type ScheduledRestart = {
  timer: ReturnType<typeof setTimeout>;
  fault: AutoRestartFault;
  dueAt: number;
  generation: number;
  attempts: number;
};

const DEFAULT_TIMEOUT_MINUTES = 5;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;

export class AutoRestartService {
  private readonly options: AutoRestartServiceOptions;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly scheduled = new Map<string, ScheduledRestart>();
  private readonly recoveryAttempts = new Map<string, number>();
  private currentGeneration = 0;

  constructor(options: AutoRestartServiceOptions) {
    this.options = options;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  async schedule(fault: AutoRestartFault): Promise<void> {
    if (this.scheduled.has(fault.key)) {
      return;
    }

    const settings = await this.resolveSettings();
    if (!settings.enabled || settings.timeoutMinutes <= 0) {
      this.options.logger.info(
        { fault, settings },
        '[service] Auto restart is disabled; skipping restart schedule',
      );
      return;
    }

    const delayMs = settings.timeoutMinutes * 60 * 1000;
    const dueAt = Date.now() + delayMs;
    const generation = ++this.currentGeneration;
    const timer = this.setTimeoutFn(() => {
      void this.executeRestart(fault, generation);
    }, delayMs);

    this.scheduled.set(fault.key, { timer, fault, dueAt, generation, attempts: 0 });
    this.recoveryAttempts.set(fault.key, 0);
    this.options.logger.warn(
      {
        fault,
        timeoutMinutes: settings.timeoutMinutes,
        dueAt: new Date(dueAt).toISOString(),
        generation,
      },
      '[service] Auto restart scheduled after persistent bridge fault',
    );
  }

  clear(key: string, maxGeneration?: number): void {
    const scheduled = this.scheduled.get(key);
    if (!scheduled) {
      if (maxGeneration === undefined) {
        this.recoveryAttempts.delete(key);
      }
      return;
    }

    if (maxGeneration !== undefined && scheduled.generation > maxGeneration) {
      this.options.logger.info(
        { key, scheduledGeneration: scheduled.generation, maxGeneration },
        '[service] Newer auto restart schedule detected; skipping clear',
      );
      return;
    }

    this.clearTimeoutFn(scheduled.timer);
    this.scheduled.delete(key);
    this.recoveryAttempts.delete(key);
    this.options.logger.info(
      { fault: scheduled.fault, generation: scheduled.generation },
      '[service] Auto restart schedule cleared after recovery',
    );
  }

  clearAll(): void {
    this.recoveryAttempts.clear();
    for (const key of this.scheduled.keys()) {
      this.clear(key);
    }
  }

  getPending(): Array<AutoRestartFault & { dueAt: number; generation: number; attempts: number }> {
    return Array.from(this.scheduled.values()).map(({ fault, dueAt, generation, attempts }) => ({
      ...fault,
      dueAt,
      generation,
      attempts,
    }));
  }

  getRecoveryAttempts(key: string): number {
    return this.scheduled.get(key)?.attempts ?? this.recoveryAttempts.get(key) ?? 0;
  }

  getCurrentGeneration(key: string): number | undefined {
    return this.scheduled.get(key)?.generation;
  }

  private async resolveSettings(): Promise<AutoRestartSettings> {
    const settings = await this.options.loadSettings();
    return {
      enabled: settings.autoRestart?.enabled ?? true,
      timeoutMinutes: settings.autoRestart?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES,
      processFallback: settings.autoRestart?.processFallback ?? false,
    };
  }

  private async executeRestart(fault: AutoRestartFault, targetGeneration?: number): Promise<void> {
    const currentScheduled = this.scheduled.get(fault.key);
    if (targetGeneration !== undefined && currentScheduled?.generation !== targetGeneration) {
      // The scheduled fault was already updated or cleared
      return;
    }

    const previousAttempts =
      currentScheduled?.attempts ?? this.recoveryAttempts.get(fault.key) ?? 0;
    this.scheduled.delete(fault.key);

    try {
      const settings = await this.resolveSettings();
      if (!settings.enabled || settings.timeoutMinutes <= 0) {
        this.options.logger.info(
          { fault, settings },
          '[service] Auto restart was disabled before timeout; skipping restart',
        );
        return;
      }

      if (this.options.recoverFault && fault.portId) {
        const currentAttempts = previousAttempts + 1;
        const maxAttempts = this.options.maxBridgeRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS;

        let recovered = false;
        try {
          recovered = await this.options.recoverFault(fault);
        } catch (error) {
          this.options.logger.error(
            { err: error, fault, portId: fault.portId },
            '[service] Failed to restart affected bridge',
          );
          recovered = false;
        }

        if (recovered) {
          if (!this.scheduled.has(fault.key)) {
            this.recoveryAttempts.delete(fault.key);
          }
          this.options.logger.info(
            { fault, portId: fault.portId },
            '[service] Affected bridge restarted successfully',
          );
          return;
        }

        if (currentAttempts >= maxAttempts) {
          this.recoveryAttempts.set(fault.key, currentAttempts);
          if (settings.processFallback) {
            this.options.logger.error(
              { fault, attempts: currentAttempts, maxAttempts, portId: fault.portId },
              '[service] Affected bridge recovery failed repeatedly; falling back to process restart',
            );
            await this.options.triggerRestart();
            this.options.restartProcess();
          } else {
            this.options.logger.warn(
              { fault, attempts: currentAttempts, maxAttempts, portId: fault.portId },
              '[service] Affected bridge recovery failed repeatedly; keeping bridge in error state without process restart (process fallback disabled)',
            );
          }
          return;
        }

        this.options.logger.warn(
          { fault, attempts: currentAttempts, maxAttempts, portId: fault.portId },
          '[service] Failed to restart affected bridge; rescheduling recovery retry',
        );

        // If a new fault was already scheduled during recovery execution, keep it with its own clean attempts (0).
        // Otherwise, schedule the retry with incremented attempts.
        if (!this.scheduled.has(fault.key)) {
          this.recoveryAttempts.set(fault.key, currentAttempts);
          const delayMs = settings.timeoutMinutes * 60 * 1000;
          const dueAt = Date.now() + delayMs;
          const generation = ++this.currentGeneration;
          const timer = this.setTimeoutFn(() => {
            void this.executeRestart(fault, generation);
          }, delayMs);
          this.scheduled.set(fault.key, {
            timer,
            fault,
            dueAt,
            generation,
            attempts: currentAttempts,
          });
        }
        return;
      }

      if (settings.processFallback) {
        this.options.logger.warn(
          { fault },
          '[service] Auto restart timeout reached; restarting process',
        );
        await this.options.triggerRestart();
        this.options.restartProcess();
      } else {
        this.options.logger.warn(
          { fault },
          '[service] Auto restart timeout reached; process restart disabled',
        );
      }
    } catch (error) {
      this.options.logger.error({ err: error, fault }, '[service] Failed to execute auto restart');
    }
  }
}
