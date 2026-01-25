<script lang="ts">
  import type {
    BridgeInfo,
    UnifiedEntity,
    BridgeSerialInfo,
    ActivityLog,
    BridgeStatus,
    StatusMessage,
    EntityCategory,
    BridgeErrorPayload,
  } from '../types';
  import EntityCard from '../components/EntityCard.svelte';
  import RecentActivity from '../components/RecentActivity.svelte';
  import SetupWizard from '../components/SetupWizard.svelte';
  import SystemTopology from '../components/SystemTopology.svelte';

  import HintBubble from '$lib/components/HintBubble.svelte';
  import { t } from 'svelte-i18n';

  import Button from '$lib/components/Button.svelte';

  let {
    bridgeInfo,
    infoLoading,
    infoError,
    portMetadata,
    mqttUrl,
    entities,
    selectedPortId,
    showInactive,
    showEntities,
    showAutomations,
    showScripts,
    hasInactiveEntities = false,
    activityLogs,
    mqttConnectionStatus = 'idle' as 'idle' | 'connecting' | 'connected' | 'error',
    portStatuses = [],
    onSelect,
    onToggleInactive,
    onToggleEntities,
    onToggleAutomations,
    onToggleScripts,
  }: {
    bridgeInfo: BridgeInfo | null;
    infoLoading: boolean;
    infoError: string;
    portMetadata: Array<
      BridgeSerialInfo & {
        configFile: string;
        error?: string;
        errorInfo?: BridgeErrorPayload | null;
        status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
      }
    >;
    mqttUrl: string;
    entities: UnifiedEntity[];
    selectedPortId: string | null;
    showInactive: boolean;
    showEntities: boolean;
    showAutomations: boolean;
    showScripts: boolean;
    hasInactiveEntities?: boolean;
    activityLogs: ActivityLog[];
    mqttConnectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
    portStatuses?: {
      portId: string;
      status: BridgeStatus | 'unknown';
      message?: string;
      errorInfo?: BridgeErrorPayload | null;
    }[];
    onSelect?: (entityId: string, portId: string | undefined, category: EntityCategory) => void;
    onToggleInactive?: () => void;
    onToggleEntities?: () => void;
    onToggleAutomations?: () => void;
    onToggleScripts?: () => void;
  } = $props();

  const portIds = $derived.by<string[]>(() =>
    portMetadata.map(
      (
        port: BridgeSerialInfo & {
          configFile: string;
          error?: string;
          status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
        },
      ) => port.portId,
    ),
  );
  const activePortId = $derived.by<string | null>(() =>
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : (portIds[0] ?? null),
  );

  const activePortMetadata = $derived.by<
    | (BridgeSerialInfo & {
        configFile: string;
        error?: string;
        errorInfo?: BridgeErrorPayload | null;
        status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
      })
    | undefined
  >(() => {
    if (!activePortId) return undefined;
    return portMetadata.find((p) => p.portId === activePortId);
  });

  // App.svelte에서 이미 dashboardEntities로 포트별 필터링을 완료하여 전달하므로,
  // 여기서는 전달받은 entities를 그대로 사용합니다.
  const visibleEntities = $derived.by<UnifiedEntity[]>(() => entities);
  let searchText = $state('');
  let debouncedSearchText = $state('');
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isSearchExpanded = $state(false);
  let searchInput = $state<HTMLInputElement | null>(null);
  let hintDismissed = $state(false);

  const isSearchActive = $derived.by<boolean>(
    () => isSearchExpanded || searchText.trim().length > 0,
  );

  const searchedEntities = $derived.by<UnifiedEntity[]>(() => {
    const query = debouncedSearchText.trim().toLowerCase();
    if (!query) return visibleEntities;
    return visibleEntities.filter((entity) => {
      const searchText = [
        entity.displayName,
        entity.id,
        entity.description,
        entity.category,
        entity.portId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchText.includes(query);
    });
  });

  function getBridgeErrorMessage(): string | undefined {
    if (!bridgeInfo?.errorInfo) return bridgeInfo?.error ? $t(`errors.${bridgeInfo.error}`) : '';
    return $t(`errors.${bridgeInfo.errorInfo.code}`, {
      default:
        bridgeInfo.errorInfo.message || bridgeInfo.errorInfo.detail || bridgeInfo.errorInfo.code,
    });
  }

  const activeSerialErrorMessage = $derived.by<string | null>(() => {
    if (!activePortId) return null;

    // 1. Check portStatuses (runtime status) - only show serial-source errors here
    const portStatus = portStatuses.find((p) => p.portId === activePortId);
    if (portStatus?.errorInfo && portStatus.errorInfo.source === 'serial') {
      return $t(`errors.${portStatus.errorInfo.code}`, {
        default:
          portStatus.errorInfo.message || portStatus.errorInfo.detail || portStatus.errorInfo.code,
      });
    }

    // 2. Check portMetadata (config/initialization status) - only show serial-source errors
    if (activePortMetadata?.errorInfo && activePortMetadata.errorInfo.source === 'serial') {
      return $t(`errors.${activePortMetadata.errorInfo.code}`, {
        default:
          activePortMetadata.errorInfo.message ||
          activePortMetadata.errorInfo.detail ||
          activePortMetadata.errorInfo.code,
      });
    }

    return null;
  });

  // Check if there's a critical error (serial or core) that should hide entity sections
  const hasCriticalError = $derived.by<boolean>(() => {
    // Check activePortMetadata for errors
    if (activePortMetadata?.status === 'error') return true;
    if (activePortMetadata?.errorInfo) return true;
    // Check bridgeInfo for core errors
    if (bridgeInfo?.errorInfo?.source === 'core') return true;
    if (bridgeInfo?.errorInfo?.source === 'service') return true;
    return false;
  });

  function handleSelect(entityId: string, portId: string | undefined, category: EntityCategory) {
    onSelect?.(entityId, portId, category);
  }

  function handleSearchFocus() {
    isSearchExpanded = true;
  }

  function handleSearchBlur() {
    if (!searchText.trim()) {
      isSearchExpanded = false;
    }
  }

  function handleSearchChipClick() {
    isSearchExpanded = true;
    searchInput?.focus();
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSearchChipClick();
    }
  }

  // Restart functionality
  let isRestarting = $state(false);

  $effect(() => {
    const nextValue = searchText;
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      debouncedSearchText = nextValue;
    }, 250);

    return () => {
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
    };
  });

  async function handleRestart() {
    if (isRestarting) return;

    if (!confirm($t('settings.app_control.restart_confirm'))) return;

    isRestarting = true;
    try {
      // 1. Get One-time Token
      const tokenRes = await fetch('./api/system/restart/token');
      if (!tokenRes.ok) throw new Error('Failed to get restart token');
      const { token } = await tokenRes.json();

      // 2. Send Restart Request with Token
      const res = await fetch('./api/system/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Restart failed');
      }

      // Auto-reload after 5 seconds
      setTimeout(() => window.location.reload(), 5000);
    } catch (err) {
      console.error('Restart failed:', err);
      isRestarting = false;
    }
  }
</script>

<div class="dashboard-view">
  {#if infoLoading && !bridgeInfo && !infoError}
    <div class="loading-state">
      <p class="hint">{$t('dashboard.loading_bridge')}</p>
    </div>
  {:else if infoError}
    <div class="error-state">
      <p class="error">{$t(`errors.${infoError}`)}</p>
      <div class="error-actions">
        <Button variant="primary" onclick={() => window.location.reload()}>
          {$t('common.retry')}
        </Button>
      </div>
    </div>
  {:else if !bridgeInfo}
    <div class="empty-state">
      <p class="empty">{$t('dashboard.no_bridge_info')}</p>
    </div>
  {:else if bridgeInfo.error === 'CONFIG_INITIALIZATION_REQUIRED' || bridgeInfo.restartRequired}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else}
    {#if bridgeInfo.error}
      <div class="bridge-error">
        <p class="error subtle">
          {$t('dashboard.bridge_error', { values: { error: getBridgeErrorMessage() } })}
        </p>
      </div>
    {/if}

    <!-- System Topology Visualization -->
    <SystemTopology
      {mqttUrl}
      mqttStatus={mqttConnectionStatus}
      portMetadata={activePortMetadata}
      bridgeStatus={bridgeInfo.status}
      globalError={bridgeInfo.errorInfo?.source === 'core' ||
      bridgeInfo.errorInfo?.source === 'service'
        ? bridgeInfo.errorInfo
        : activePortMetadata?.errorInfo?.source === 'core'
          ? activePortMetadata.errorInfo
          : null}
      mqttError={bridgeInfo.errorInfo?.source === 'mqtt'
        ? bridgeInfo.errorInfo.message
        : mqttConnectionStatus === 'error'
          ? $t('dashboard.mqtt_error')
          : null}
      serialError={activeSerialErrorMessage}
    />

    {#if hasCriticalError}
      <!-- Error State: Show refresh and restart buttons -->
      <div class="error-action-container">
        <p class="error-hint">{$t('dashboard.error_hint_restart')}</p>
        <div class="error-buttons">
          <Button variant="secondary" onclick={() => window.location.reload()}>
            {$t('common.refresh')}
          </Button>
          <Button variant="primary" onclick={handleRestart} isLoading={isRestarting}>
            {isRestarting
              ? $t('settings.app_control.restarting')
              : $t('settings.app_control.restart')}
          </Button>
        </div>
      </div>
    {:else}
      <!-- Recent Activity Section -->
      {#if activePortId}
        <RecentActivity activities={activityLogs} />
      {/if}

      <!-- Toggle for Inactive Entities -->
      <div class="toggle-container" aria-label={$t('dashboard.filter_section_aria')}>
        <div class="toggle-header">
          <span class="toggle-title" aria-hidden="true">
            <svg class="filter-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                d="M3 5h18l-7 8v5l-4 2v-7L3 5z"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="sr-only">{$t('dashboard.filter_title')}</span>
        </div>
        <div class="toggle-group">
          <div
            class="filter-chip search-chip"
            class:expanded={isSearchActive}
            role="button"
            tabindex="0"
            onclick={handleSearchChipClick}
            onkeydown={handleSearchKeydown}
          >
            <span class="search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="7" />
                <line x1="16.5" y1="16.5" x2="21" y2="21" />
              </svg>
            </span>
            <input
              type="text"
              placeholder={$t('dashboard.search_placeholder')}
              bind:value={searchText}
              bind:this={searchInput}
              onfocus={handleSearchFocus}
              onblur={handleSearchBlur}
            />
          </div>
          <button
            type="button"
            class:active={showEntities}
            class="filter-chip"
            aria-pressed={showEntities}
            onclick={() => onToggleEntities?.()}
          >
            {$t('dashboard.show_entities')}
          </button>
          <button
            type="button"
            class:active={showAutomations}
            class="filter-chip"
            aria-pressed={showAutomations}
            onclick={() => onToggleAutomations?.()}
          >
            {$t('dashboard.show_automations')}
          </button>
          <button
            type="button"
            class:active={showScripts}
            class="filter-chip"
            aria-pressed={showScripts}
            onclick={() => onToggleScripts?.()}
          >
            {$t('dashboard.show_scripts')}
          </button>
          <div class="inactive-chip-wrapper">
            {#if hasInactiveEntities && !hintDismissed}
              <HintBubble onDismiss={() => (hintDismissed = true)} autoCloseMs={10000}>
                {$t('dashboard.hint_inactive_performance')}
              </HintBubble>
            {/if}
            <button
              type="button"
              class:active={showInactive}
              class="filter-chip"
              aria-pressed={showInactive}
              onclick={() => onToggleInactive?.()}
            >
              {$t('dashboard.show_inactive_entities')}
            </button>
          </div>
        </div>
      </div>

      <!-- Entity Grid Section -->
      <div class="entity-grid">
        {#if searchedEntities.length === 0 && !infoLoading}
          <div class="empty-grid">
            <p class="empty full-width">{$t('dashboard.no_devices_found')}</p>
          </div>
        {:else}
          {#each searchedEntities as entity (entity.id + '-' + (entity.portId || 'unknown') + '-' + (entity.category || 'entity'))}
            <EntityCard
              {entity}
              onSelect={() => handleSelect(entity.id, entity.portId, entity.category ?? 'entity')}
            />
          {/each}
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .dashboard-view {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .toggle-container {
    position: relative;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
  }

  .toggle-header {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    text-align: right;
  }

  .toggle-title {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    color: #e2e8f0;
  }

  .filter-icon {
    width: 1.1rem;
    height: 1.1rem;
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
    border: 0;
  }

  .toggle-group {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .filter-chip {
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    background: rgba(15, 23, 42, 0.6);
    color: #cbd5f5;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .search-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    min-width: 2.4rem;
    overflow: hidden;
  }

  .search-chip input {
    width: 0;
    opacity: 0;
    border: none;
    background: transparent;
    color: #e2e8f0;
    font-size: 0.8rem;
    font-weight: 600;
    outline: none;
    transition: width 0.2s ease, opacity 0.2s ease;
  }

  .search-chip.expanded input {
    width: 10rem;
    opacity: 1;
  }

  .search-chip input::placeholder {
    color: rgba(203, 213, 245, 0.6);
  }

  .search-icon {
    display: inline-flex;
    align-items: center;
    width: 1rem;
    height: 1rem;
  }

  .filter-chip:hover {
    border-color: rgba(148, 163, 184, 0.6);
    color: #e2e8f0;
  }

  .filter-chip.active {
    border-color: rgba(59, 130, 246, 0.7);
    background: rgba(59, 130, 246, 0.2);
    color: #eff6ff;
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
  }

  .inactive-chip-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .error-actions {
    margin-top: 1rem;
    display: flex;
    justify-content: center;
  }

  .entity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .hint,
  .empty {
    color: #94a3b8;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }

  .bridge-error {
    margin-top: 1rem;
  }

  .error-action-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem;
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
  }

  .error-hint {
    color: #94a3b8;
    font-size: 0.9rem;
    text-align: center;
  }

  .error-buttons {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }
</style>
