<script lang="ts">
  import type { UnifiedEntity, ParsedPayloadEntry } from '../types';
  import { t } from 'svelte-i18n';

  let { entity, onSelect }: { entity: UnifiedEntity; onSelect?: () => void } = $props();

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

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.();
    }
  }

  function formatEntityId(entityInfo: UnifiedEntity): string {
    const categoryPrefix = entityInfo.category && entityInfo.category !== 'entity';
    const prefix = categoryPrefix ? entityInfo.category : entityInfo.type;
    return prefix ? `${prefix}.${entityInfo.id}` : entityInfo.id;
  }
</script>

<div
  role="button"
  tabindex="0"
  class="entity-card"
  class:inactive={!entity.isActive}
  onclick={() => onSelect?.()}
  onkeydown={handleKeydown}
>
  <header class="card-header">
    <div class="header-title">
      <h3>{entity.displayName}</h3>
      {#if entity.errorCount && entity.errorCount > 0}
        <span class="error-indicator" aria-label={$t('dashboard.entity_card.error_label')}>
          ❗️
        </span>
      {/if}
      {#if entity.category === 'automation'}
        <span class="entity-type-badge automation"
          >{$t('dashboard.entity_card.automation_badge')}</span
        >
      {:else if entity.category === 'script'}
        <span class="entity-type-badge script">{$t('dashboard.entity_card.script_badge')}</span>
      {/if}
    </div>
    <span class="entity-id-badge">{formatEntityId(entity)}</span>
  </header>

  <div class="card-body">
    <!-- Status Section -->
    <div class="status-section">
      {#if entity.category && entity.category !== 'entity'}
        {#if entity.description}
          <p class="entity-description">{entity.description}</p>
        {:else}
          <span class="no-status">{$t('dashboard.entity_card.no_status')}</span>
        {/if}
      {:else if entity.statePayload}
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
        <span class="no-status">{$t('dashboard.entity_card.no_status')}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .entity-card {
    display: flex;
    flex-direction: column;
    text-align: left;
    height: 100%;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .entity-card:hover {
    border-color: rgba(148, 163, 184, 0.2);
    background: rgba(30, 41, 59, 0.7);
  }
  .entity-card:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
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

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .error-indicator {
    font-size: 1rem;
    color: #ef4444;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .entity-type-badge {
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .entity-type-badge.automation {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
  }

  .entity-type-badge.script {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
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

  .entity-description {
    margin: 0;
    color: #cbd5f5;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  @media (max-width: 480px) {
    .card-header {
      padding: 0.75rem 1rem;
    }
    .card-body {
      padding: 1rem;
    }
  }
</style>
