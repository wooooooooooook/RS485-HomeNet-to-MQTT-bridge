<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { fade } from 'svelte/transition';

  let {
    onDismiss,
    children,
    variant = 'default',
    autoCloseMs,
  }: {
    onDismiss?: () => void;
    children: any;
    variant?: 'default' | 'error';
    autoCloseMs?: number;
  } = $props();

  let bubbleEl: HTMLDivElement;
  let position = $state<'top' | 'bottom'>('top');
  let horizontalAlign = $state<'left' | 'right'>('right');
  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    await tick();
    adjustPosition();

    // 자동 닫힘 타이머 설정
    if (autoCloseMs && autoCloseMs > 0 && onDismiss) {
      autoCloseTimer = setTimeout(() => {
        onDismiss();
      }, autoCloseMs);
    }
  });

  onDestroy(() => {
    // 타이머 정리
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  });

  function adjustPosition() {
    if (!bubbleEl) return;

    const rect = bubbleEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 수직 위치 조정: 위에 공간이 부족하면 아래에 표시
    if (rect.top < 0) {
      position = 'bottom';
    } else {
      position = 'top';
    }

    // 수평 위치 조정: 왼쪽으로 잘리면 왼쪽 정렬로 변경
    if (rect.right > viewportWidth) {
      horizontalAlign = 'left';
    } else if (rect.left < 0) {
      horizontalAlign = 'right';
    }
  }
</script>

<div
  class="hint-bubble"
  class:error={variant === 'error'}
  class:position-bottom={position === 'bottom'}
  class:align-left={horizontalAlign === 'left'}
  class:align-right={horizontalAlign === 'right'}
  bind:this={bubbleEl}
  transition:fade
>
  <div class="content">
    {@render children()}
  </div>
  <button class="close-btn" onclick={onDismiss} aria-label="Dismiss">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  </button>
  <div class="arrow"></div>
</div>

<style>
  .hint-bubble {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 12px;
    background: #3b82f6;
    color: white;
    padding: 0.5rem 2rem 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
    z-index: 1000;
    pointer-events: auto;
  }

  /* 수평 정렬 */
  .hint-bubble.align-left {
    left: 0;
    right: auto;
  }

  .hint-bubble.align-right {
    left: auto;
    right: 0;
  }

  /* 아래쪽에 표시 */
  .hint-bubble.position-bottom {
    bottom: auto;
    top: 100%;
    margin-bottom: 0;
    margin-top: 12px;
  }

  .hint-bubble.error {
    background: #dc2626;
  }

  .hint-bubble.error .arrow {
    background: #dc2626;
  }

  .arrow {
    position: absolute;
    bottom: -4px;
    left: 20px;
    transform: rotate(45deg);
    width: 8px;
    height: 8px;
    background: #3b82f6;
  }

  .hint-bubble.align-right .arrow {
    left: auto;
    right: 20px;
  }

  /* 아래쪽에 표시될 때 화살표는 위로 */
  .hint-bubble.position-bottom .arrow {
    bottom: auto;
    top: -4px;
  }

  .close-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: white;
  }

  .close-btn:focus-visible {
    outline: 2px solid white;
    outline-offset: -2px;
    border-radius: 4px;
  }
</style>
