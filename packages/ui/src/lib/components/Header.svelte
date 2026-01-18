<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { BridgeErrorPayload, BridgeStatus } from '../types';
  import HintBubble from './HintBubble.svelte';

  let {
    onToggleSidebar,
    portIds = [],
    activePortId = null,
    portStatuses = [],
    onPortChange,
    onAddBridge,
  }: {
    onToggleSidebar?: () => void;
    portIds?: string[];
    activePortId?: string | null;
    portStatuses?: {
      portId: string;
      status: BridgeStatus | 'unknown';
      message?: string;
      errorInfo?: BridgeErrorPayload | null;
    }[];
    onPortChange?: (portId: string) => void;
    onAddBridge?: () => void;
  } = $props();

  let isDropdownOpen = $state(false);
  let useDropdownMode = $state(false);
  let errorBubblePortId = $state<string | null>(null);
  let portTabsContainer: HTMLDivElement | undefined = $state();
  let headerRightSection: HTMLDivElement | undefined = $state();

  function getPortStatus(portId: string): BridgeStatus | 'unknown' {
    const portStatus = portStatuses.find((p) => p.portId === portId);
    return portStatus?.status ?? 'unknown';
  }

  function getPortErrorMessage(portId: string): string | undefined {
    const portStatus = portStatuses.find((p) => p.portId === portId);
    if (portStatus?.errorInfo) {
      return $t(`errors.${portStatus.errorInfo.code}`, {
        default:
          portStatus.errorInfo.message || portStatus.errorInfo.detail || portStatus.errorInfo.code,
      });
    }
    return portStatus?.message;
  }

  function handlePortClick(portId: string) {
    const status = getPortStatus(portId);
    const errorMessage = getPortErrorMessage(portId);

    if (status === 'error' && errorMessage) {
      if (errorBubblePortId === portId) {
        errorBubblePortId = null;
      } else {
        errorBubblePortId = portId;
      }
    } else {
      errorBubblePortId = null;
    }

    onPortChange?.(portId);

    if (useDropdownMode) {
      isDropdownOpen = false;
    }
  }

  function handleAddBridge() {
    onAddBridge?.();
    isDropdownOpen = false;
  }

  function handleClickOutside(event: MouseEvent) {
    if (
      isDropdownOpen &&
      headerRightSection &&
      !headerRightSection.contains(event.target as Node)
    ) {
      isDropdownOpen = false;
      errorBubblePortId = null;
    }
  }

  // ResizeObserver로 공간 측정하여 드롭다운 모드 결정
  onMount(() => {
    if (typeof window === 'undefined') return;

    const checkOverflow = () => {
      if (!portTabsContainer || !headerRightSection) return;

      // 임시로 드롭다운 모드 해제하여 실제 필요 너비 측정
      useDropdownMode = false;

      requestAnimationFrame(() => {
        if (!portTabsContainer || !headerRightSection) return;

        const containerWidth = headerRightSection.clientWidth;
        const tabsWidth = portTabsContainer.scrollWidth;

        // 탭들이 컨테이너보다 넓으면 드롭다운 모드로 전환
        useDropdownMode = tabsWidth > containerWidth - 20;
      });
    };

    const resizeObserver = new ResizeObserver(checkOverflow);

    if (headerRightSection) {
      resizeObserver.observe(headerRightSection);
    }

    // 포트 추가/변경 시에도 체크
    const unsubscribe = $effect.root(() => {
      $effect(() => {
        // portIds 변경 감지
        portIds;
        checkOverflow();
      });
    });

    document.addEventListener('click', handleClickOutside);

    return () => {
      resizeObserver.disconnect();
      unsubscribe();
      document.removeEventListener('click', handleClickOutside);
    };
  });
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

  <div class="right-section" bind:this={headerRightSection}>
    {#if portIds.length > 0}
      {#if useDropdownMode}
        <!-- 드롭다운 모드 -->
        <div class="port-dropdown">
          <button
            class="dropdown-trigger"
            type="button"
            onclick={() => (isDropdownOpen = !isDropdownOpen)}
            aria-expanded={isDropdownOpen}
            aria-haspopup="listbox"
          >
            <span
              class="port-status-dot"
              data-state={activePortId ? getPortStatus(activePortId) : 'unknown'}
              aria-hidden="true"
            ></span>
            <span class="dropdown-label">{activePortId || $t('header.select_port')}</span>
            <span class="dropdown-arrow" aria-hidden="true">{isDropdownOpen ? '▲' : '▼'}</span>
          </button>

          {#if isDropdownOpen}
            <div class="dropdown-menu" role="listbox">
              {#each portIds as portId (portId)}
                <div class="dropdown-item-wrapper">
                  <button
                    class="dropdown-item"
                    class:active={activePortId === portId}
                    type="button"
                    role="option"
                    aria-selected={activePortId === portId}
                    onclick={() => handlePortClick(portId)}
                    data-state={getPortStatus(portId)}
                  >
                    <span class="port-status-dot" aria-hidden="true"></span>
                    {portId}
                  </button>
                  {#if errorBubblePortId === portId && getPortErrorMessage(portId)}
                    <HintBubble
                      variant="error"
                      onDismiss={() => (errorBubblePortId = null)}
                      autoCloseMs={3000}
                    >
                      <span class="error-message">{getPortErrorMessage(portId)}</span>
                    </HintBubble>
                  {/if}
                </div>
              {/each}
              <button class="dropdown-item add-bridge-item" type="button" onclick={handleAddBridge}>
                <span class="add-icon">+</span>
                {$t('settings.bridge_config.add_button')}
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <!-- 인라인 탭 모드 -->
        <div class="port-tabs" bind:this={portTabsContainer}>
          {#each portIds as portId (portId)}
            <div class="port-button-wrapper">
              <button
                class="port-tab"
                class:active={activePortId === portId}
                type="button"
                onclick={() => handlePortClick(portId)}
                data-state={getPortStatus(portId)}
                aria-current={activePortId === portId ? 'true' : undefined}
                title={$t(`common.status.${getPortStatus(portId)}`)}
              >
                <span class="port-status-dot" aria-hidden="true"></span>
                <span class="sr-only">{$t(`common.status.${getPortStatus(portId)}`)}</span>
                {portId}
              </button>
              {#if errorBubblePortId === portId && getPortErrorMessage(portId)}
                <HintBubble
                  variant="error"
                  onDismiss={() => (errorBubblePortId = null)}
                  autoCloseMs={3000}
                >
                  <span class="error-message">{getPortErrorMessage(portId)}</span>
                </HintBubble>
              {/if}
            </div>
          {/each}
          <button
            class="port-tab add-bridge-btn"
            type="button"
            onclick={handleAddBridge}
            aria-label={$t('settings.bridge_config.add_button')}
            title={$t('settings.bridge_config.add_button')}
          >
            +
          </button>
        </div>
      {/if}
    {:else}
      <!-- 포트가 없을 때 Add 버튼만 표시 -->
      <button
        class="port-tab add-bridge-btn"
        type="button"
        onclick={handleAddBridge}
        aria-label={$t('settings.bridge_config.add_button')}
        title={$t('settings.bridge_config.add_button')}
      >
        +
      </button>
    {/if}
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
    flex-shrink: 0;
  }

  .right-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    overflow: visible;
    min-width: 0;
    position: relative;
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

  .beta-badge {
    background-color: #f59e0b;
    color: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: bold;
    user-select: none;
  }

  /* Port Tabs - 인라인 모드 */
  .port-tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: nowrap;
    white-space: nowrap;
  }

  .port-button-wrapper {
    position: relative;
  }

  .port-tab {
    padding: 0.5rem 0.9rem;
    border-radius: 10px;
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
    border: 1px solid rgba(148, 163, 184, 0.3);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
  }

  .port-tab.active {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.6);
    color: #bfdbfe;
    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
  }

  .port-tab:hover {
    border-color: rgba(148, 163, 184, 0.6);
  }

  .port-tab:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
    z-index: 10;
  }

  .add-bridge-btn {
    padding: 0.5rem 0.8rem !important;
    background: rgba(30, 41, 59, 0.4) !important;
    border: 1px dashed rgba(148, 163, 184, 0.4) !important;
    color: #94a3b8 !important;
    line-height: 1;
  }

  .add-bridge-btn:hover {
    border-color: #60a5fa !important;
    color: #60a5fa !important;
    background: rgba(59, 130, 246, 0.1) !important;
  }

  /* Port Status Dot */
  .port-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #64748b;
    flex-shrink: 0;
  }

  [data-state='started'] .port-status-dot,
  .port-status-dot[data-state='started'] {
    background-color: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  [data-state='starting'] .port-status-dot,
  .port-status-dot[data-state='starting'] {
    background-color: #f59e0b;
    animation: pulse 2s infinite;
  }

  [data-state='error'] .port-status-dot,
  .port-status-dot[data-state='error'] {
    background-color: #ef4444;
  }

  [data-state='stopped'] .port-status-dot,
  .port-status-dot[data-state='stopped'] {
    background-color: #64748b;
  }

  [data-state='reconnecting'] .port-status-dot,
  .port-status-dot[data-state='reconnecting'] {
    background-color: #f59e0b;
    animation: pulse 1s infinite;
  }

  /* 드롭다운 모드 */
  .port-dropdown {
    position: relative;
  }

  .dropdown-trigger {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.9rem;
    border-radius: 10px;
    background: rgba(59, 130, 246, 0.15);
    color: #bfdbfe;
    border: 1px solid rgba(59, 130, 246, 0.6);
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .dropdown-trigger:hover {
    background: rgba(59, 130, 246, 0.25);
  }

  .dropdown-label {
    font-weight: 500;
  }

  .dropdown-arrow {
    font-size: 0.65rem;
    opacity: 0.7;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    min-width: 180px;
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 0.5rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    animation: dropdownFadeIn 0.15s ease;
  }

  @keyframes dropdownFadeIn {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .dropdown-item-wrapper {
    position: relative;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: transparent;
    color: #e2e8f0;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }

  .dropdown-item:hover {
    background: rgba(148, 163, 184, 0.15);
  }

  .dropdown-item.active {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
  }

  .add-bridge-item {
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    margin-top: 0.25rem;
    padding-top: 0.75rem;
    color: #94a3b8;
  }

  .add-bridge-item:hover {
    color: #60a5fa;
  }

  .add-icon {
    font-weight: 600;
    font-size: 1rem;
  }

  .error-message {
    color: #fca5a5;
    font-weight: 500;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
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

    .logo-text {
      display: none;
    }
  }
</style>
