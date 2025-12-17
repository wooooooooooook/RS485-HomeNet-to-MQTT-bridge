<script lang="ts">
  import { sineOut } from 'svelte/easing';
  import { fade } from 'svelte/transition';
  import { t } from 'svelte-i18n';

  interface ActivityLog {
    timestamp: number;
    message: string;
    details?: any;
    portId?: string;
  }

  let { activities = [] } = $props<{
    activities: ActivityLog[];
  }>();

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };
</script>

<div class="recent-activity-container">
  <h4>{$t('dashboard.recent_activity.title')}</h4>
  {#if activities.length === 0}
    <p>{$t('dashboard.recent_activity.empty')}</p>
  {:else}
    <ul>
      <!--
        Use a composite key of timestamp and message to identify unique items.
        Using index with reverse() causes the entire list to re-render/animate on every update.
      -->
      {#each [...activities].reverse() as activity (`${activity.timestamp}-${activity.message}`)}
        <li in:fade|local={{ duration: 300, easing: sineOut }}>
          <span class="time">{formatTime(activity.timestamp)}</span>
          <span class="message">{activity.message}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .recent-activity-container {
    height: 200px;
    overflow: hidden;
    position: relative;
    border: 1px solid rgba(148, 163, 184, 0.1);
    padding: 1rem;
    padding-bottom: 0; /* Remove bottom padding to let UL handle it */
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.5);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  h4 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: #cbd5e1;
    font-weight: 600;
    flex-shrink: 0;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    /*
      Use flex-grow to fill the remaining space.
      Add bottom padding to content so the last item isn't covered by the gradient/scrollbar overlap area.
    */
    flex-grow: 1;
    overflow-y: auto;
    overflow-x: auto;
    scrollbar-width: thin;
    padding-bottom: 1rem;
  }

  /* Fade-out effect at the bottom */
  .recent-activity-container::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0; /* Start from left edge (ignoring padding) */
    right: 0;
    /*
       Make the gradient height cover the bottom area.
       Since we removed container bottom padding and added it to UL,
       the scrollbar is at the very bottom of the container.
       We raise the gradient slightly or make it transparent at the very bottom?
       Actually, standard "fade out" usually sits *above* the scrollbar if possible.
       But scrollbar is inside the element.

       Let's stick to the requested visual "Gradient at bottom".
    */
    height: 3rem;
    background: linear-gradient(to top, rgba(30, 41, 59, 1) 20%, transparent);
    pointer-events: none;
    z-index: 1;
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
  }

  li {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 0.3rem;
    display: flex;
    gap: 0.75rem;
    font-family: monospace;
    width: max-content;
    min-width: 100%;
  }

  .time {
    color: #64748b;
    flex-shrink: 0;
  }

  .message {
    white-space: nowrap;
    color: #cbd5e1;
  }

  p {
    color: #94a3b8;
    font-style: italic;
    padding-bottom: 1rem; /* Add padding here too if empty */
  }
</style>
