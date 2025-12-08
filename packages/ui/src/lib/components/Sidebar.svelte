<script lang="ts">
  export let activeView: 'dashboard' | 'analysis';
</script>

<aside class="sidebar">
  <div class="logo">
    <span class="logo-icon">H</span>
    <span class="logo-text">Homenet2MQTT</span>
  </div>

  <nav>
    <button
      class="nav-item"
      class:active={activeView === 'dashboard'}
      on:click={() => (activeView = 'dashboard')}
    >
      <span class="icon">📊</span>
      <span class="label">대시보드</span>
    </button>
    <button
      class="nav-item"
      class:active={activeView === 'analysis'}
      on:click={() => (activeView = 'analysis')}
    >
      <span class="icon">📈</span>
      <span class="label">분석</span>
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
  }

  .nav-item:hover {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
  }

  .nav-item.active {
    background: rgba(37, 99, 235, 0.1);
    color: #3b82f6;
    font-weight: 600;
  }

  .icon {
    font-size: 1.2rem;
  }
</style>
