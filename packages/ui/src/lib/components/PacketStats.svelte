<script lang="ts">
  import type { PacketStats } from '../types';

  export let stats: PacketStats | null = null;
</script>

<div class="stats-container">
  <h2>패킷 간격 분석</h2>
  <div class="stats-grid">
    {#if stats}
      <div class="stat-item">
        <span class="label">패킷 간격 (평균 ± 표준편차)</span>
        <strong>{stats.packetAvg} ± {stats.packetStdDev} ms</strong>
      </div>
      <div class="stat-item">
        <span class="label">유휴 간격 (평균 ± 표준편차)</span>
        <strong>{stats.idleAvg > 0 ? `${stats.idleAvg} ± ${stats.idleStdDev} ms` : 'N/A'}</strong>
      </div>
      <div class="stat-item">
        <span class="label">유휴 발생 간격 (평균 ± 표준편차)</span>
        <strong
          >{stats.idleOccurrenceAvg > 0
            ? `${stats.idleOccurrenceAvg} ± ${stats.idleOccurrenceStdDev} ms`
            : 'N/A'}</strong
        >
      </div>
      <div class="stat-item">
        <span class="label">표본 크기</span>
        <strong>{stats.sampleSize}</strong>
      </div>
    {:else}
      <p class="empty">분석중입니다...</p>
    {/if}
  </div>
</div>

<style>
  .stats-container {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 2rem;
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
