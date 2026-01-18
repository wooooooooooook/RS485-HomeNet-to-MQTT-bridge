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
  import PortToolbar from '$lib/components/PortToolbar.svelte';
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
    statusMessage = null,
    portStatuses = [],
    onSelect,
    onToggleInactive,
    onToggleEntities,
    onToggleAutomations,
    onToggleScripts,
    onPortChange,
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
    statusMessage?: StatusMessage | null;
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
    onPortChange?: (portId: string) => void;
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
  let hintDismissed = $state(false);
  let showAddBridgeModal = $state(false);

  function getBridgeErrorMessage(): string | undefined {
    if (!bridgeInfo?.errorInfo) return bridgeInfo?.error ? $t(`errors.${bridgeInfo.error}`) : '';
    return $t(`errors.${bridgeInfo.errorInfo.code}`, {
      default:
        bridgeInfo.errorInfo.message || bridgeInfo.errorInfo.detail || bridgeInfo.errorInfo.code,
    });
  }

  const activeSerialErrorMessage = $derived.by<string | null>(() => {
    if (!activePortId) return null;

    // 1. Check portStatuses (runtime status)
    const portStatus = portStatuses.find((p) => p.portId === activePortId);
    if (portStatus?.errorInfo) {
      return $t(`errors.${portStatus.errorInfo.code}`, {
        default:
          portStatus.errorInfo.message || portStatus.errorInfo.detail || portStatus.errorInfo.code,
      });
    }
    if (portStatus?.message) return portStatus.message;

    // 2. Check portMetadata (config/initialization status)
    if (activePortMetadata?.errorInfo) {
      if (activePortMetadata.errorInfo.source !== 'serial') return null; // Should not happen for port errors usually
      return $t(`errors.${activePortMetadata.errorInfo.code}`, {
        default:
          activePortMetadata.errorInfo.message ||
          activePortMetadata.errorInfo.detail ||
          activePortMetadata.errorInfo.code,
      });
    }
    if (activePortMetadata?.error) {
      // Typically 'CONFIG_ERROR' or similar keys
      return $t(`errors.${activePortMetadata.error}`, { default: activePortMetadata.error });
    }

    return null;
  });

  function handleSelect(entityId: string, portId: string | undefined, category: EntityCategory) {
    onSelect?.(entityId, portId, category);
  }
</script>

<div class="dashboard-view">
  {#if infoLoading && !bridgeInfo && !infoError}
    <div class="loading-state">
      <p class="hint">{$t('dashboard.loading_bridge')}</p>
    </div>
  {:else if infoError === 'CONFIG_INITIALIZATION_REQUIRED'}
    <SetupWizard oncomplete={() => window.location.reload()} />
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
  {:else if bridgeInfo.error === 'CONFIG_INITIALIZATION_REQUIRED'}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else if bridgeInfo.restartRequired}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else}
    {#if bridgeInfo.error}
      <div class="bridge-error">
        <p class="error subtle">
          {$t('dashboard.bridge_error', { values: { error: getBridgeErrorMessage() } })}
        </p>
      </div>
    {/if}

    <!-- Toolbar Section -->
    <PortToolbar
      {portIds}
      {activePortId}
      {portStatuses}
      showAddButton={true}
      {onPortChange}
      onAddBridge={() => (showAddBridgeModal = true)}
    />

    <!-- System Topology Visualization -->
    <SystemTopology
      {mqttUrl}
      mqttStatus={mqttConnectionStatus}
      portMetadata={activePortMetadata}
      bridgeStatus={bridgeInfo.status}
      globalError={bridgeInfo.errorInfo?.source === 'core' ||
      bridgeInfo.errorInfo?.source === 'service'
        ? bridgeInfo.errorInfo
        : null}
      mqttError={bridgeInfo.errorInfo?.source === 'mqtt'
        ? bridgeInfo.errorInfo.message
        : mqttConnectionStatus === 'error'
          ? $t('dashboard.mqtt_error')
          : null}
      serialError={activeSerialErrorMessage}
    />

    <!-- Recent Activity Section -->
    {#if activePortId}
      <RecentActivity activities={activityLogs} />
    {/if}

    <!-- Toggle for Inactive Entities -->
    <div class="toggle-container" aria-label={$t('dashboard.filter_section_aria')}>
      <div class="toggle-header">
        <span class="toggle-title">{$t('dashboard.filter_title')}</span>
      </div>
      {#if hasInactiveEntities && !hintDismissed}
        <HintBubble onDismiss={() => (hintDismissed = true)} autoCloseMs={10000}>
          {$t('dashboard.hint_inactive_performance')}
        </HintBubble>
      {/if}
      <div class="toggle-group">
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

    <!-- Entity Grid Section -->
    <div class="entity-grid">
      {#if visibleEntities.length === 0 && !infoLoading}
        <div class="empty-grid">
          <p class="empty full-width">{$t('dashboard.no_devices_found')}</p>
        </div>
      {:else}
        {#each visibleEntities as entity (entity.id + '-' + (entity.portId || 'unknown') + '-' + (entity.category || 'entity'))}
          <EntityCard
            {entity}
            onSelect={() => handleSelect(entity.id, entity.portId, entity.category ?? 'entity')}
          />
        {/each}
      {/if}
    </div>
  {/if}

  {#if showAddBridgeModal}
    <SetupWizard mode="add" onclose={() => (showAddBridgeModal = false)} />
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
    font-size: 0.85rem;
    font-weight: 600;
    color: #e2e8f0;
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
</style>
