<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
</script>

<header class="header">
  <div class="left-section">
    <button
      class="ghost mobile-menu-btn"
      type="button"
      onclick={() => dispatch('toggleSidebar')}
      aria-label="메뉴 열기"
    >
      <span class="icon">☰</span>
    </button>

    <div class="logo">
      <span class="logo-icon">H</span>
      <span class="logo-text">Homenet2MQTT</span>
    </div>

    <div class="alpha-badge">ALPHA</div>
  </div>
</header>

<style>
  .header {
    height: 65px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 2rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    background-color: #0f172a;
    position: sticky;
    top: 0;
    z-index: 60;
    box-sizing: border-box;
  }

  .left-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo-icon {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    color: white;
  }

  .logo-text {
    font-size: 1.1rem;
    font-weight: 700;
    color: #e2e8f0;
  }

  .mobile-menu-btn {
    display: none;
    font-size: 1.5rem;
    padding: 0.25rem 0.5rem;
    line-height: 1;
  }

  button.ghost {
    background: transparent;
    color: #94a3b8;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  button.ghost:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
    border-color: rgba(148, 163, 184, 0.4);
  }

  button.ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alpha-badge {
    background-color: #f59e0b;
    color: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: bold;
    user-select: none;
  }

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
    100% {
      opacity: 1;
    }
  }

  @media (max-width: 768px) {
    .header {
      padding: 0 1rem;
    }

    .mobile-menu-btn {
      display: block;
    }

    .logo-text {
      display: none;
    }
  }
</style>
