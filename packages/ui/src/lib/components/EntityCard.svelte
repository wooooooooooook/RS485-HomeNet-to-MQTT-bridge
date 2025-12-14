<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { UnifiedEntity, ParsedPayloadEntry } from '../types';

  let { entity } = $props<{ entity: UnifiedEntity }>();

  const dispatch = createEventDispatcher<{
    select: void;
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

<button
  class="entity-card"
  class:inactive={!entity.statePayload}
  onclick={() => dispatch('select')}
  onkeydown={(e) => ['Enter', ' '].includes(e.key) && dispatch('select')}
>
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
  </div>
</button>

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
  .entity-card.inactive {
    opacity: 0.5;
  }

  .entity-card.inactive:hover {
    border-color: rgba(148, 163, 184, 0.1);
    background: rgba(30, 41, 59, 0.5);
  }

  .card-header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(15, 23, 42, 0.3);
    cursor: pointer;
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
</style>
