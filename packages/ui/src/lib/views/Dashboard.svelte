<script lang="ts">
  import type { BridgeInfo, UnifiedEntity, CommandInfo } from '../types';
  import EntityCard from '../components/EntityCard.svelte';
  import { createEventDispatcher } from 'svelte';

  export let bridgeInfo: BridgeInfo | null;
  export let infoLoading: boolean;
  export let infoError: string;
  export let unifiedEntities: UnifiedEntity[];
  export let deviceStates: Map<string, string>;
  export let availableCommands: CommandInfo[];
  export let executingCommands: Set<string>;
  export let commandInputs: Record<string, any>;

  const dispatch = createEventDispatcher<{
    execute: { cmd: CommandInfo; value?: any };
  }>();

  function handleExecute(event: CustomEvent<{ cmd: CommandInfo; value?: any }>) {
    dispatch('execute', event.detail);
  }
</script>

<div class="dashboard-view">
  {#if infoLoading && !bridgeInfo && !infoError}
    <div class="loading-state">
      <p class="hint">브리지 정보를 불러오는 중입니다...</p>
    </div>
  {:else if infoError}
    <div class="error-state">
      <p class="error">{infoError}</p>
    </div>
  {:else if !bridgeInfo}
    <div class="empty-state">
      <p class="empty">브리지 정보가 없습니다.</p>
    </div>
  {:else}
    <!-- Metadata Section -->
    <div class="viewer-meta">
      <div>
        <span class="label">Config File</span>
        <strong>{bridgeInfo.configFile || 'N/A'}</strong>
      </div>
      <div>
        <span class="label">Serial Path</span>
        <strong>{bridgeInfo.serialPath || '입력되지 않음'}</strong>
      </div>
      <div>
        <span class="label">Baud Rate</span>
        <strong>{bridgeInfo.baudRate}</strong>
      </div>
      <div>
        <span class="label">MQTT URL</span>
        <strong>{bridgeInfo.mqttUrl}</strong>
      </div>
    </div>

    {#if bridgeInfo.error}
      <div class="bridge-error">
        <p class="error subtle">브리지 오류: {bridgeInfo.error}</p>
      </div>
    {/if}

    <!-- Entity Grid Section -->
    <div class="entity-grid">
      {#if unifiedEntities.length === 0 && !infoLoading}
        {#if deviceStates.size === 0 && availableCommands.length === 0}
          <div class="empty-grid">
            <p class="empty full-width">감지된 장치나 설정된 명령이 없습니다.</p>
          </div>
        {/if}
      {:else}
        {#each unifiedEntities as entity (entity.id)}
          <EntityCard {entity} {executingCommands} {commandInputs} on:execute={handleExecute} />
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .dashboard-view {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .viewer-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
    padding: 1.5rem;
    border-radius: 12px;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
  }

  .viewer-meta div {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .label {
    font-size: 0.85rem;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  strong {
    color: #f1f5f9;
    font-size: 1rem;
    font-family: monospace;
  }

  .bridge-error {
    margin-top: 1rem;
  }

  .error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .entity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .hint,
  .empty {
    color: #94a3b8;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }
</style>
