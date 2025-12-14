<script lang="ts">
  import { afterUpdate } from 'svelte';
  import { sineOut } from 'svelte/easing';
  import { fade } from 'svelte/transition';

  interface ActivityLog {
    timestamp: number;
    message: string;
    details?: any;
  }

  let { activities = [] } = $props<{
    activities: ActivityLog[];
  }>();

  let listElement: HTMLUListElement;

  afterUpdate(() => {
    if (listElement) {
      listElement.scrollTop = listElement.scrollHeight;
    }
  });

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
  <h4>최근 활동</h4>
  {#if activities.length === 0}
    <p>최근 활동이 없습니다.</p>
  {:else}
    <ul bind:this={listElement}>
      {#each activities as activity (activity.timestamp)}
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
    height: 150px; /* Approximately 6 lines of small text */
    overflow: hidden;
    position: relative;
    border: 1px solid rgba(148, 163, 184, 0.1);
    padding: 1rem;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.5);
    box-sizing: border-box;
  }

  h4 {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: #cbd5e1;
    font-weight: 600;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    height: calc(100% - 2rem);
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* Fade-out effect at the top */
  .recent-activity-container::before {
    content: '';
    position: absolute;
    top: 2.5rem; /* Adjusted for new padding */
    left: 0;
    right: 0;
    height: 1.5rem;
    background: linear-gradient(to bottom, rgba(30, 41, 59, 1), transparent);
    pointer-events: none;
    z-index: 1;
  }

  li {
    font-size: 0.85rem;
    color: #94a3b8;
    margin-bottom: 0.3rem;
    display: flex;
    gap: 0.75rem;
    font-family: monospace;
  }

  .time {
    color: #64748b;
    flex-shrink: 0;
  }

  .message {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #cbd5e1;
  }

  .error {
    color: #ef4444;
  }

  p {
      color: #94a3b8;
      font-style: italic;
  }
</style>
