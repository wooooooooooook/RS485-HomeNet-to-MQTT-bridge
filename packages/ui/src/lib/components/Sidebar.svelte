<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  let { activeView = $bindable<'dashboard' | 'analysis' | 'settings'>('dashboard'), isOpen = false } = $props<{
    activeView: 'dashboard' | 'analysis' | 'settings';
    isOpen?: boolean;
  }>();

  const dispatch = createEventDispatcher();

  function handleNavClick(view: typeof activeView) {
    activeView = view;
    dispatch('close');
  }
</script>

{#if isOpen}
  <button
    type="button"
    class="sidebar-backdrop"
    aria-label="사이드바 닫기"
    on:click={() => dispatch('close')}
  ></button>
{/if}

<aside class="sidebar" class:open={isOpen}>
  <div class="logo">
    <span class="logo-icon">H</span>
    <span class="logo-text">Homenet2MQTT</span>
  </div>

  <nav>
    <button
      class="nav-item"
      class:active={activeView === 'dashboard'}
      aria-current={activeView === 'dashboard' ? 'page' : undefined}
      on:click={() => handleNavClick('dashboard')}
    >
      <span class="icon">📊</span>
      <span class="label">대시보드</span>
    </button>
    <button
      class="nav-item"
      class:active={activeView === 'analysis'}
      aria-current={activeView === 'analysis' ? 'page' : undefined}
      on:click={() => handleNavClick('analysis')}
    >
      <span class="icon">📈</span>
      <span class="label">분석</span>
    </button>
    <button
      class="nav-item"
      class:active={activeView === 'settings'}
      aria-current={activeView === 'settings' ? 'page' : undefined}
      on:click={() => handleNavClick('settings')}
    >
      <span class="icon">⚙️</span>
      <span class="label">설정</span>
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
    height: 100vh;
    box-sizing: border-box;
    position: fixed;
    left: 0;
    top: 0;
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

  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 2.5rem;
    padding: 0 0.5rem;
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
