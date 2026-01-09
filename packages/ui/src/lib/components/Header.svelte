<script lang="ts">
  import { t } from 'svelte-i18n';

  let { onToggleSidebar }: { onToggleSidebar?: () => void } = $props();
</script>

<header class="header">
  <div class="left-section">
    <button
      class="ghost mobile-menu-btn"
      type="button"
      onclick={() => onToggleSidebar?.()}
      aria-label={$t('header.toggle_menu')}
    >
      <span class="icon" aria-hidden="true">☰</span>
    </button>

    <div class="logo">
      <img src="./logo.png" alt="" class="logo-icon" aria-hidden="true" />
      <span class="logo-text">Homenet2MQTT</span>
    </div>

    <div
      class="beta-badge"
      role="status"
      title={$t('header.beta_badge_label')}
      aria-label={$t('header.beta_badge_label')}
    >
      BETA
    </div>
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
    border-radius: 4px;
    object-fit: contain;
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

  .beta-badge {
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
      padding: 0 0.75rem;
    }

    .mobile-menu-btn {
      display: block;
    }
  }
</style>
