<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import VirtualList from '@humanspeak/svelte-virtual-list';
  import type { ActivityLog } from '../types';

  let {
    logs = [],
    title,
    emptyMessage,
    height = '220px',
  }: {
    logs: ActivityLog[];
    title: string;
    emptyMessage: string;
    height?: string;
  } = $props();

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const currentLocale = $locale === 'ko' ? 'ko-KR' : 'en-US';
    return date.toLocaleTimeString(currentLocale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const reversedLogs = $derived([...logs].reverse());
</script>

{#snippet renderActivityItem(activity: ActivityLog, _index: number)}
  <div class="activity-item">
    <span class="time">[{formatTime(activity.timestamp)}]</span>
    <span class="message">
      {#if activity.code.startsWith('log.')}
        {$t(`logs.${activity.code.replace('log.', '')}`, { values: activity.params })}
      {:else if activity.message}
        {activity.message}
      {:else}
        {activity.code}
      {/if}
    </span>
  </div>
{/snippet}

<div class="activity-card" style={`--activity-list-height: ${height};`}>
  <h4 class="card-title">{title}</h4>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="activity-list" role="log" tabindex="0" aria-label={title}>
    {#if logs.length === 0}
      <p class="empty">{emptyMessage}</p>
    {:else}
      <VirtualList items={reversedLogs} renderItem={renderActivityItem} />
    {/if}
  </div>
</div>

<style>
  .activity-card {
    border: 1px solid rgba(148, 163, 184, 0.1);
    padding: 1rem;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.5);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .card-title {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: #cbd5e1;
    font-weight: 600;
  }

  .activity-list {
    height: var(--activity-list-height);
    overflow: hidden;
    position: relative;
    font-family: monospace;
    font-size: 0.85rem;
  }

  .activity-item {
    display: flex;
    gap: 0.75rem;
    color: #94a3b8;
    margin-bottom: 0.3rem;
    width: max-content;
    min-width: 100%;
  }

  .time {
    color: #64748b;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .message {
    white-space: nowrap;
    color: #cbd5e1;
  }

  .empty {
    color: #94a3b8;
    font-style: italic;
    padding-bottom: 1rem;
  }

  :global(.activity-list .virtual-list-container) {
    height: 100%;
  }
</style>
