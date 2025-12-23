<script lang="ts">
  import { t } from 'svelte-i18n';

  let {
    activeView = $bindable<'dashboard' | 'analysis' | 'gallery' | 'settings'>('dashboard'),
    isOpen = false,
    onClose,
  }: {
    activeView: 'dashboard' | 'analysis' | 'gallery' | 'settings';
    isOpen?: boolean;
    onClose?: () => void;
  } = $props();

  function handleNavClick(view: typeof activeView) {
    activeView = view;
    onClose?.();
  }
</script>

{#if isOpen}
  <button
    type="button"
    class="sidebar-backdrop"
    aria-label={$t('sidebar.close_aria')}
    onclick={() => onClose?.()}
  ></button>
{/if}

<aside class="sidebar" class:open={isOpen}>
  <nav>
    <button
      class="nav-item"
      class:active={activeView === 'dashboard'}
      aria-current={activeView === 'dashboard' ? 'page' : undefined}
      onclick={() => handleNavClick('dashboard')}
    >
      <span class="icon">📊</span>
      <span class="label">{$t('sidebar.dashboard')}</span>
    </button>
    <button
      class="nav-item"
      class:active={activeView === 'analysis'}
      aria-current={activeView === 'analysis' ? 'page' : undefined}
      onclick={() => handleNavClick('analysis')}
    >
      <span class="icon">📈</span>
      <span class="label">{$t('sidebar.analysis')}</span>
    </button>
    <button
      class="nav-item"
      class:active={activeView === 'gallery'}
      aria-current={activeView === 'gallery' ? 'page' : undefined}
      onclick={() => handleNavClick('gallery')}
    >
      <span class="icon">📦</span>
      <span class="label">{$t('sidebar.gallery')}</span>
    </button>
    <button
      class="nav-item"
      class:active={activeView === 'settings'}
      aria-current={activeView === 'settings' ? 'page' : undefined}
      onclick={() => handleNavClick('settings')}
    >
      <span class="icon">⚙️</span>
      <span class="label">{$t('sidebar.settings')}</span>
    </button>
  </nav>
</aside>

<style>
  .sidebar {
    width: 250px;
    background: rgba(15, 23, 42, 0.95);
    border-right: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    height: calc(100vh - 65px);
    box-sizing: border-box;
    position: fixed;
    left: 0;
    z-index: 50;
    transition: transform 0.3s ease-in-out;
  }

  .sidebar-backdrop {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 40;
    backdrop-filter: blur(2px);
    border: none;
    padding: 0;
    cursor: pointer;
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: #94a3b8;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
  }

  .nav-item:hover {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
  }

  .nav-item:focus-visible {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
  }

  .nav-item.active {
    background: rgba(37, 99, 235, 0.1);
    color: #3b82f6;
    font-weight: 600;
  }

  .icon {
    font-size: 1.2rem;
  }

  @media (max-width: 768px) {
    .sidebar {
      transform: translateX(-100%);
    }

    .sidebar.open {
      transform: translateX(0);
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
    }

    .sidebar-backdrop {
      display: block;
    }
  }
</style>
