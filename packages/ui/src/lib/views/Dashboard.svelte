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
  export let showInactive: boolean;

  const dispatch = createEventDispatcher<{
    select: { entityId: string };
    toggleInactive: void;
  }>();

  function handleSelect(entityId: string) {
    dispatch('select', { entityId });
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

    <!-- Toolbar Section -->
    <div class="dashboard-toolbar">
      <label class="toggle-switch">
        <input type="checkbox" checked={showInactive} on:change={() => dispatch('toggleInactive')} />
        <span class="slider"></span>
        비활성 엔티티 보기
      </label>
    </div>

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
          <EntityCard {entity} on:select={() => handleSelect(entity.id)} />
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
  .dashboard-toolbar {
    display: flex;
    justify-content: flex-end;
    padding: 1rem 0;
  }

  .toggle-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    font-size: 0.9rem;
    color: #cbd5e1;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    width: 36px;
    height: 20px;
    background-color: #334155;
    border-radius: 10px;
    transition: background-color 0.2s;
    margin-right: 0.75rem;
    position: relative;
  }

  .slider:before {
    content: '';
    position: absolute;
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  input:checked + .slider {
    background-color: #3b82f6;
  }

  input:checked + .slider:before {
    transform: translateX(16px);
  }
</style>
