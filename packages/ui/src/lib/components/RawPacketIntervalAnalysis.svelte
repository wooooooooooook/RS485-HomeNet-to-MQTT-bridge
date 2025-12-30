<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { PacketStats } from '../types';

  let { stats = null } = $props<{ stats?: PacketStats | null }>();
</script>

<div class="stats-container">
  <h2>{$t('analysis.stats.title')}</h2>
  <div class="stats-grid">
    {#if stats}
      <div class="stat-item">
        <span class="label">{$t('analysis.stats.packet_interval')}</span>
        <strong>{stats.packetAvg} ± {stats.packetStdDev} ms</strong>
      </div>
      <div class="stat-item">
        <span class="label">{$t('analysis.stats.idle_interval')}</span>
        <strong>{stats.idleAvg > 0 ? `${stats.idleAvg} ± ${stats.idleStdDev} ms` : 'N/A'}</strong>
      </div>
      <div class="stat-item">
        <span class="label">{$t('analysis.stats.idle_occurrence')}</span>
        <strong
          >{stats.idleOccurrenceAvg > 0
            ? `${stats.idleOccurrenceAvg} ± ${stats.idleOccurrenceStdDev} ms`
            : 'N/A'}</strong
        >
      </div>
      <div class="stat-item">
        <span class="label">{$t('analysis.stats.sample_size')}</span>
        <strong>{stats.sampleSize}</strong>
      </div>
    {:else}
      <p class="empty">{$t('analysis.stats.analyzing')}</p>
    {/if}
  </div>
</div>

<style>
  .stats-container {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0 0 1.5rem;
    color: #e2e8f0;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1.5rem;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .label {
    font-size: 0.85rem;
    color: #94a3b8;
  }

  strong {
    font-size: 1.1rem;
    color: #f1f5f9;
    font-family: monospace;
  }

  .empty {
    color: #64748b;
    font-style: italic;
  }
</style>
