<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { UnifiedEntity, CommandInfo, ParsedPayloadEntry } from '../types';

  export let entity: UnifiedEntity;
  export let executingCommands: Set<string>;
  // We'll manage inputs locally since they are transient
  export let commandInputs: Record<string, any> = {};

  const dispatch = createEventDispatcher<{
    execute: { cmd: CommandInfo; value?: any };
  }>();

  function parsePayload(payload: string): ParsedPayloadEntry[] | null {
    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) {
          return parsed.map((value, index) => ({
            key: String(index),
            value: formatPayloadValue(value),
          }));
        }
        return Object.entries(parsed).map(([key, value]) => ({
          key,
          value: formatPayloadValue(value),
        }));
      }
    } catch {
      return null;
    }
    return null;
  }

  function formatPayloadValue(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }
    return String(value);
  }
</script>

<article class="entity-card">
  <header class="card-header">
    <h3>{entity.displayName}</h3>
    <span class="entity-id-badge">{entity.id}</span>
  </header>

  <div class="card-body">
    <!-- Status Section -->
    <div class="status-section">
      {#if entity.statePayload}
        {@const parsedPayload = parsePayload(entity.statePayload)}
        {#if parsedPayload}
          <div class="payload-list">
            {#each parsedPayload as entry (entry.key)}
              <div class="payload-row">
                <span class="payload-key">{entry.key}</span>
                <span class="payload-value">{entry.value}</span>
              </div>
            {/each}
          </div>
        {:else}
          <strong class="payload-raw">{entity.statePayload}</strong>
        {/if}
      {:else}
        <span class="no-status">상태 정보 없음</span>
      {/if}
    </div>

    <!-- Command Section -->
    {#if entity.commands.length > 0}
      <div class="command-section">
        <div class="command-buttons">
          {#each entity.commands as cmd (cmd.commandName)}
            {#if cmd.inputType === 'number'}
              <div class="command-input-group">
                <input
                  type="number"
                  min={cmd.min}
                  max={cmd.max}
                  step={cmd.step}
                  bind:value={commandInputs[`${cmd.entityId}_${cmd.commandName}`]}
                  class="temp-input"
                />
                <button
                  class="command-btn input-btn"
                  on:click={() =>
                    dispatch('execute', {
                      cmd,
                      value: commandInputs[`${cmd.entityId}_${cmd.commandName}`],
                    })}
                  disabled={executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                >
                  {#if executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                    ...
                  {:else}
                    {cmd.commandName.replace('command_', '')}
                  {/if}
                </button>
              </div>
            {:else}
              <button
                class="command-btn"
                class:on={cmd.commandName.includes('on') ||
                  cmd.commandName.includes('heat') ||
                  cmd.commandName.includes('open') ||
                  cmd.commandName.includes('unlock')}
                class:off={cmd.commandName.includes('off') ||
                  cmd.commandName.includes('close') ||
                  cmd.commandName.includes('lock')}
                on:click={() => dispatch('execute', { cmd })}
                disabled={executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
              >
                {#if executingCommands.has(`${cmd.entityId}_${cmd.commandName}`)}
                  ...
                {:else}
                  {cmd.commandName.replace('command_', '').toUpperCase()}
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
</article>

<style>
  .entity-card {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .entity-card:hover {
    border-color: rgba(148, 163, 184, 0.2);
    background: rgba(30, 41, 59, 0.7);
  }

  .card-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(15, 23, 42, 0.3);
  }

  .card-header h3 {
    font-size: 1rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0;
  }

  .entity-id-badge {
    font-size: 0.75rem;
    background: rgba(148, 163, 184, 0.1);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: #94a3b8;
    font-family: monospace;
  }

  .card-body {
    padding: 1.25rem;
  }

  .status-section {
    margin-bottom: 1.25rem;
  }

  .payload-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .payload-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
  }

  .payload-row:last-child {
    border-bottom: none;
  }

  .payload-key {
    color: #94a3b8;
  }

  .payload-value {
    color: #e2e8f0;
    font-weight: 500;
  }

  .payload-raw {
    display: block;
    padding: 0.75rem;
    background: rgba(15, 23, 42, 0.5);
    border-radius: 6px;
    font-family: monospace;
    font-size: 0.9rem;
    color: #10b981;
    word-break: break-all;
  }

  .no-status {
    color: #64748b;
    font-style: italic;
    font-size: 0.9rem;
  }

  .command-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .command-btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(30, 41, 59, 0.5);
    color: #e2e8f0;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .command-btn:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.4);
  }

  .command-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .command-btn.on {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.2);
    color: #34d399;
  }

  .command-btn.on:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
    border-color: rgba(16, 185, 129, 0.4);
  }

  .command-btn.off {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }

  .command-btn.off:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .command-input-group {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .temp-input {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: white;
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    width: 60px;
    font-size: 0.9rem;
  }
</style>
