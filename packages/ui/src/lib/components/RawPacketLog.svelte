<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { RawPacketWithInterval, PacketStats as PacketStatsType } from '../types';
  import PacketStats from './PacketStats.svelte';

  let {
    rawPackets = [],
    isStreaming,
    stats = null,
  } = $props<{
    rawPackets?: RawPacketWithInterval[];
    isStreaming: boolean;
    stats?: PacketStatsType | null;
  }>();

  const dispatch = createEventDispatcher();
  const toHexPairs = (hex: string) => hex.match(/.{1,2}/g)?.map((pair) => pair.toUpperCase()) ?? [];

  function toggleStreaming() {
    if (isStreaming) {
      dispatch('stop');
    } else {
      dispatch('start');
    }
  }
</script>

<div class="log-section">
  <div class="log-header">
    <h2>{$t('analysis.raw_log.title')}</h2>
    <div class="header-right">
      <button class="ghost-sm" onclick={toggleStreaming}>
        {isStreaming ? `⏹ ${$t('analysis.raw_log.stop')}` : `▶ ${$t('analysis.raw_log.start')}`}
      </button>
    </div>
  </div>
  <p class="description">{$t('analysis.raw_log.desc')}</p>

  {#if stats || isStreaming}
    <PacketStats {stats} />
  {/if}

  <div class="log-list raw-list">
    {#if rawPackets.length === 0}
      <p class="empty">{$t('analysis.raw_log.empty')}</p>
    {:else}
      {#each [...rawPackets].reverse() as packet, index (`${packet.receivedAt}-${packet.topic}-${index}`)}
        <div class="log-item">
          <span class="time">[{new Date(packet.receivedAt).toLocaleTimeString()}]</span>
          <span class="interval"
            >{packet.interval !== null
              ? `${packet.interval >= 0 ? '+' : ''}${packet.interval}ms`
              : ''}</span
          >
          <code class="payload">{toHexPairs(packet.payload).join(' ')}</code>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .log-section {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 2rem;
  }

  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0;
    color: #e2e8f0;
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .log-list {
    background: rgba(15, 23, 42, 0.5);
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.1);
    height: 400px;
    overflow-y: auto;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.85rem;
  }

  .log-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.05);
    align-items: center;
    color: #cbd5e1;
  }

  .log-item:last-child {
    border-bottom: none;
  }

  .time {
    color: #64748b;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .interval {
    color: #f59e0b;
    width: 60px;
    text-align: right;
    font-size: 0.8rem;
  }

  .payload {
    color: #10b981;
    font-weight: 600;
    font-family: monospace;
  }

  .empty {
    padding: 2rem;
    text-align: center;
    color: #64748b;
    font-style: italic;
  }

  .ghost-sm {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .ghost-sm:hover {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
  }
</style>
