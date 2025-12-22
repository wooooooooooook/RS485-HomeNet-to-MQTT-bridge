<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import type { ActivityLog } from '../types';
  import VirtualList from '@humanspeak/svelte-virtual-list';

  let { activities = [] } = $props<{
    activities: ActivityLog[];
  }>();

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const currentLocale = $locale === 'ko' ? 'ko-KR' : 'en-US';
    return date.toLocaleTimeString(currentLocale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const reversedActivities = $derived([...activities].reverse());
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

<div class="recent-activity-container">
  <h4>{$t('dashboard.recent_activity.title')}</h4>
  <div class="activity-list">
    {#if activities.length === 0}
      <p>{$t('dashboard.recent_activity.empty')}</p>
    {:else}
      <VirtualList items={reversedActivities} renderItem={renderActivityItem} />
    {/if}
  </div>
</div>

<style>
  .recent-activity-container {
    height: 200px;
    border: 1px solid rgba(148, 163, 184, 0.1);
    padding: 1rem;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.5);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* Ensure content stays inside */
    position: relative;
  }

  h4 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: #cbd5e1;
    font-weight: 600;
    flex-shrink: 0;
  }

  .activity-list {
    flex-grow: 1;
    overflow: hidden; /* Prevent parent scrolling, let VirtualList handle it */
    position: relative;
    font-family: monospace;
    font-size: 0.85rem;
  }

  /* Fade-out effect at the bottom */
  .recent-activity-container::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3rem;
    background: linear-gradient(to top, rgba(30, 41, 59, 1) 20%, transparent);
    pointer-events: none;
    z-index: 1;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
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

  p {
    color: #94a3b8;
    font-style: italic;
    padding-bottom: 1rem;
  }

  /* VirtualList Customization - based on PacketLog fix */
  :global(.activity-list .virtual-list-container) {
    height: 100%;
  }
</style>
