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
  import Modal from '$lib/components/Modal.svelte';
  import Dialog from '$lib/components/Dialog.svelte';
  import { t, locale } from 'svelte-i18n';
  import { onMount, unmount } from 'svelte';
  import { triggerSystemRestart as restartApp } from '../utils/appControl';
  import { formatTime, formatRelativeTime } from '$lib/utils/time';

  import Button from '$lib/components/Button.svelte';
  import MonacoYamlEditor from '$lib/components/MonacoYamlEditor.svelte';

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
    hideAutomationScripts = false,
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
    hideAutomationScripts?: boolean;
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

  let now = $state(Date.now());

  onMount(() => {
    const interval = setInterval(() => {
      now = Date.now();
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
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
  let isAddModalOpen = $state(false);
  let addStep = $state<'select-category' | 'select-entity-type' | 'edit-yaml'>('select-category');
  let selectedCategory = $state<EntityCategory | null>(null);
  let selectedEntityType = $state<string | null>(null);
  let yamlDraft = $state('');
  let yamlCopyMessage = $state<string | null>(null);

  const entityTypeOptions = [
    'light',
    'climate',
    'valve',
    'button',
    'sensor',
    'fan',
    'switch',
    'lock',
    'number',
    'select',
    'text_sensor',
    'text',
    'binary_sensor',
  ];

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

  const currentTypeLabel = $derived.by<string | null>(() => {
    if (selectedCategory === 'automation') return 'Automation';
    if (selectedCategory === 'script') return 'Script';
    return selectedEntityType ? formatEntityType(selectedEntityType) : null;
  });

  const currentDocUrl = $derived.by<string | null>(() => {
    const baseUrl = 'https://github.com/wooooooooooook/homenet2mqtt/blob/main/docs';
    if (selectedCategory === 'automation') return `${baseUrl}/AUTOMATION.md`;
    if (selectedCategory === 'script') return `${baseUrl}/SCRIPTS.md`;
    if (selectedEntityType)
      return `${baseUrl}/config-schema/${selectedEntityType.replace('_', '-')}.md`;
    return null;
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

  const lastActivityMap = $derived.by<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const log of activityLogs) {
      if (
        (log.code === 'log.automation_triggered' ||
          log.code === 'log.automation_run_action_executed' ||
          log.code === 'log.automation_run_guard_failed') &&
        log.params?.automationId
      ) {
        // Automation logs usually have portId
        const key = `${log.portId ?? 'unknown'}:${log.params.automationId}`;
        // Store latest timestamp
        const current = map.get(key);
        if (!current || log.timestamp > current) {
          map.set(key, log.timestamp);
        }
      } else if (log.code === 'log.script_action_executed' && log.params?.scriptId) {
        const key = `${log.portId ?? 'unknown'}:${log.params.scriptId}`;
        const current = map.get(key);
        if (!current || log.timestamp > current) {
          map.set(key, log.timestamp);
        }
      }
    }
    return map;
  });

  const displayActivityLogs = $derived.by<ActivityLog[]>(() => {
    if (!hideAutomationScripts) return activityLogs;
    return activityLogs.filter(
      (log) => !log.code.startsWith('log.automation_') && !log.code.startsWith('log.script_'),
    );
  });

  function getLastActivity(entity: UnifiedEntity): { text: string; tooltip: string } | null {
    if (entity.category !== 'automation' && entity.category !== 'script') return null;

    const key = `${entity.portId ?? 'unknown'}:${entity.id}`;
    const ts = lastActivityMap.get(key);
    if (!ts) return null;

    // Use dummy read of 'now' to trigger reactivity
    const _dummy = now;

    let relative = formatRelativeTime(ts, $locale ?? 'ko');
    if (relative === 'less_than_a_minute') {
      relative = $t('dashboard.entity_card.within_1_minute');
    }

    const absolute = formatTime(ts, $locale ?? undefined, {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const labelKey =
      entity.category === 'automation'
        ? 'dashboard.entity_card.last_triggered'
        : 'dashboard.entity_card.last_run';

    return {
      text: $t(labelKey, { values: { time: relative } }),
      tooltip: absolute,
    };
  }

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

  function formatEntityType(type: string) {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function openAddModal() {
    isAddModalOpen = true;
    addStep = 'select-category';
    selectedCategory = null;
    selectedEntityType = null;
    yamlDraft = '';
    yamlCopyMessage = null;
  }

  function closeAddModal() {
    isAddModalOpen = false;
  }

  function buildYamlTemplate(category: EntityCategory, entityType?: string) {
    if (category === 'automation') {
      return `id: new_automation\ntrigger:\n  - type: schedule\n    every: 5m\nthen:\n  - action: command\n    target: id(example_entity).command_on()\n`;
    }

    if (category === 'script') {
      return `id: new_script\ndescription: ${$t('dashboard.add_modal.default_script_description')}\nactions:\n  - action: command\n    target: id(example_entity).command_on()\n`;
    }

    const safeType = entityType ?? 'light';
    const typeLabel = $t(`entity_types.${safeType}`, { default: safeType });
    const nameLabel = $t('dashboard.add_modal.default_entity_name', {
      values: { type: typeLabel },
      default: `새 ${typeLabel}`,
    });

    return `id: new_${safeType}\nname: '${nameLabel}'\nstate:\n  data: [0x00]\ncommand_on:\n  data: [0x00]\n`;
  }

  function handleCategorySelect(category: EntityCategory) {
    selectedCategory = category;
    // Reset entity type if not selecting an entity to prevent state persistence (e.g. showing "Number" for Automation)
    if (category !== 'entity') {
      selectedEntityType = null;
    }

    yamlCopyMessage = null;
    if (category === 'entity') {
      addStep = 'select-entity-type';
      return;
    }

    yamlDraft = buildYamlTemplate(category);
    addStep = 'edit-yaml';
  }

  function handleEntityTypeSelect(type: string) {
    selectedEntityType = type;
    selectedCategory = 'entity';
    yamlCopyMessage = null;
    yamlDraft = buildYamlTemplate('entity', type);
    addStep = 'edit-yaml';
  }

  function handleAddStepBack() {
    yamlCopyMessage = null;
    if (addStep === 'edit-yaml' && selectedCategory === 'entity') {
      addStep = 'select-entity-type';
      return;
    }
    addStep = 'select-category';
  }

  let isAdding = $state(false);
  let addError = $state<string | null>(null);

  async function triggerSystemRestart() {
    isRestarting = true;
    dialog.title = $t('settings.app_control.restart');
    dialog.message = $t('settings.app_control.restarting');
    dialog.loadingText = $t('settings.app_control.restarting');
    dialog.variant = 'primary';
    dialog.showCancel = false;
    dialog.loading = true;
    dialog.open = true;
    await restartApp();
  }

  async function goToConfirmation() {
    if (isAdding) return;
    addError = null;

    if (!activePortId) {
      addError = $t('errors.BRIDGE_NOT_FOUND_FOR_PORT', { values: { portId: 'active' } });
      return;
    }

    showConfirmDialog({
      title: $t('dashboard.add_modal.confirm_title'),
      message: $t('dashboard.add_modal.confirm_desc'),
      confirmText: $t('dashboard.add_modal.confirm_yes'),
      variant: 'primary',
      loadingText: $t('dashboard.add_modal.saving'),
      action: async () => {
        await executeSaveAndRestart();
      },
      onSuccess: () => {
        // After successful save, close add modal and show restart feedback
        closeAddModal();
        triggerSystemRestart();
      },
    });
  }

  async function executeSaveAndRestart() {
    if (isAdding) return;
    addError = null;
    yamlCopyMessage = null;

    if (!activePortId) {
      throw new Error($t('errors.BRIDGE_NOT_FOUND_FOR_PORT', { values: { portId: 'active' } }));
    }

    isAdding = true;
    try {
      const rootKey =
        selectedCategory === 'automation'
          ? 'automation'
          : selectedCategory === 'script'
            ? 'scripts'
            : (selectedEntityType ?? 'light');

      const lines = yamlDraft.split('\n');
      const indentedYaml = lines
        .map((line, index) => (index === 0 ? `  - ${line}` : `    ${line}`))
        .join('\n');

      const finalYaml = `${rootKey}:\n${indentedYaml}`;

      const res = await fetch('./api/config/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          portId: activePortId,
          yaml: finalYaml,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to add item');
      }

      // Success
      yamlCopyMessage = $t('dashboard.add_modal.save_success');
    } catch (err) {
      console.error('Failed to add item:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      addError = $t('dashboard.add_modal.save_fail', {
        values: { error: errorMsg },
      });
      // Re-throw so the dialog can handle it (it will close the dialog)
      throw err;
    } finally {
      isAdding = false;
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

  // Dialog State
  let dialog = $state({
    open: false,
    title: '',
    message: '',
    confirmText: undefined as string | undefined,
    variant: 'primary' as 'primary' | 'danger' | 'success',
    loading: false,
    loadingText: undefined as string | undefined,
    showCancel: true,
    onConfirm: async () => {},
  });

  const closeDialog = () => {
    dialog.open = false;
  };

  const showConfirmDialog = ({
    title,
    message,
    confirmText,
    variant = 'primary',
    loadingText,
    action,
    onSuccess,
  }: {
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'primary' | 'danger' | 'success';
    loadingText?: string;
    action: () => Promise<void>;
    onSuccess?: () => void | Promise<void>;
  }) => {
    dialog.title = title;
    dialog.message = message;
    dialog.confirmText = confirmText;
    dialog.variant = variant;
    dialog.loadingText = loadingText;
    dialog.showCancel = true;
    dialog.loading = false;
    dialog.onConfirm = async () => {
      dialog.loading = true;
      try {
        await action();
        if (onSuccess) {
          await onSuccess();
        } else {
          closeDialog();
        }
      } catch (err: any) {
        closeDialog();
        // Optional: show error dialog
        console.error(err);
      } finally {
        if (!onSuccess) dialog.loading = false;
      }
    };
    dialog.open = true;
  };

  function handleRestart() {
    showConfirmDialog({
      title: $t('settings.app_control.restart'),
      message: $t('settings.app_control.restart_confirm'),
      confirmText: $t('settings.app_control.restart'),
      variant: 'danger',
      loadingText: $t('settings.app_control.restarting'),
      action: async () => triggerSystemRestart(),
      onSuccess: () => {
        // triggerSystemRestart handled the feedback
      },
    });
  }

  // Deprecated usage of performRestart, keeping for reference or removing if unused.
  // We remove performRestart since we using dialog now.

  // Auto-reload on error
  let autoReloadCountdown = $state(10);

  $effect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (infoError) {
      autoReloadCountdown = 10;
      timer = setInterval(() => {
        autoReloadCountdown--;
        if (autoReloadCountdown <= 0) {
          window.location.reload();
        }
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  });
</script>

<Dialog
  open={dialog.open}
  title={dialog.title}
  message={dialog.message}
  confirmText={dialog.confirmText}
  variant={dialog.variant}
  loading={dialog.loading}
  loadingText={dialog.loadingText}
  showCancel={dialog.showCancel}
  onconfirm={dialog.onConfirm}
  oncancel={closeDialog}
/>

{#if isAddModalOpen}
  <Modal open={true} width="900px" onclose={closeAddModal} oncancel={closeAddModal}>
    <div class="modal-content-wrapper">
      <div class="modal-header">
        <h2>{$t('dashboard.add_modal.title')}</h2>
      </div>

      <div class="modal-body">
        {#if addStep === 'select-category'}
          <section class="add-modal-section">
            <h3>{$t('dashboard.add_modal.select_category')}</h3>
            <div class="add-option-grid">
              <button
                type="button"
                class="add-option-card"
                onclick={() => handleCategorySelect('entity')}
              >
                <strong>{$t('dashboard.add_modal.category_entity')}</strong>
                <span>{$t('dashboard.add_modal.category_entity_desc')}</span>
              </button>
              <button
                type="button"
                class="add-option-card"
                onclick={() => handleCategorySelect('automation')}
              >
                <strong>{$t('dashboard.add_modal.category_automation')}</strong>
                <span>{$t('dashboard.add_modal.category_automation_desc')}</span>
              </button>
              <button
                type="button"
                class="add-option-card"
                onclick={() => handleCategorySelect('script')}
              >
                <strong>{$t('dashboard.add_modal.category_script')}</strong>
                <span>{$t('dashboard.add_modal.category_script_desc')}</span>
              </button>
            </div>
          </section>
        {:else if addStep === 'select-entity-type'}
          <section class="add-modal-section">
            <div class="section-header-with-desc">
              <h3>{$t('dashboard.add_modal.select_device_type')}</h3>
              <p class="section-desc">{$t('dashboard.add_modal.device_type_desc')}</p>
            </div>
            <div class="add-option-grid">
              {#each entityTypeOptions as entityType}
                <button
                  type="button"
                  class="add-option-card"
                  onclick={() => handleEntityTypeSelect(entityType)}
                >
                  <strong>{$t(`entity_types.${entityType}`, { default: entityType })}</strong>
                  <span>{formatEntityType(entityType)}</span>
                </button>
              {/each}
            </div>
          </section>
        {:else if addStep === 'edit-yaml'}
          <section class="add-modal-section full-height">
            <div class="yaml-header">
              <div>
                <div class="header-row">
                  <h3>{$t('dashboard.add_modal.yaml_editor_title')}</h3>
                  {#if currentTypeLabel}
                    <span class="entity-type-badge">{currentTypeLabel}</span>
                  {/if}
                </div>
                <p class="yaml-hint">{$t('dashboard.add_modal.yaml_hint')}</p>
              </div>
              {#if currentDocUrl && currentTypeLabel}
                <a href={currentDocUrl} target="_blank" rel="noopener noreferrer" class="docs-link">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  {currentTypeLabel} 문서 보기
                </a>
              {/if}
            </div>
            <!-- Replaced textarea with MonacoYamlEditor -->
            <div class="yaml-editor-container">
              <MonacoYamlEditor
                bind:value={yamlDraft}
                schemaUri={selectedCategory === 'automation'
                  ? './api/schema/entity/automation'
                  : selectedCategory === 'script'
                    ? './api/schema/entity/script'
                    : `./api/schema/entity/${selectedEntityType ?? 'light'}`}
                class="yaml-editor-instance"
              />
            </div>

            {#if addError}
              <p class="error">{addError}</p>
            {/if}
            {#if yamlCopyMessage}
              <p class="copy-message">{yamlCopyMessage}</p>
            {/if}
          </section>
        {/if}
      </div>

      <div class="modal-footer">
        <Button
          variant="secondary"
          onclick={handleAddStepBack}
          disabled={addStep === 'select-category'}
        >
          {$t('dashboard.add_modal.back')}
        </Button>
        <Button variant="secondary" onclick={closeAddModal} disabled={isAdding}>
          {$t('dashboard.add_modal.close')}
        </Button>
        {#if addStep === 'edit-yaml'}
          <Button variant="primary" onclick={goToConfirmation} isLoading={isAdding}>
            {$t('dashboard.add_modal.save')}
          </Button>
        {/if}
      </div>
    </div>
  </Modal>
{/if}

<div class="dashboard-view">
  {#if bridgeInfo?.error === 'CONFIG_INITIALIZATION_REQUIRED' || bridgeInfo?.restartRequired}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else}
    <!-- System Topology Visualization -->
    <!-- Always show topology unless we are in the setup wizard -->
    <SystemTopology
      {mqttUrl}
      mqttStatus={mqttConnectionStatus}
      portMetadata={activePortMetadata}
      bridgeStatus={bridgeInfo?.status || 'unknown'}
      globalError={infoError
        ? {
            code: 'API_ERROR',
            message: $t(`errors.${infoError}`),
            source: 'core',
            severity: 'error',
            timestamp: new Date().toISOString(),
          }
        : bridgeInfo?.errorInfo?.source === 'core' || bridgeInfo?.errorInfo?.source === 'service'
          ? bridgeInfo.errorInfo
          : activePortMetadata?.errorInfo?.source === 'core'
            ? activePortMetadata.errorInfo
            : null}
      mqttError={bridgeInfo?.errorInfo?.source === 'mqtt'
        ? bridgeInfo.errorInfo.message
        : mqttConnectionStatus === 'error'
          ? $t('dashboard.mqtt_error')
          : null}
      serialError={activeSerialErrorMessage}
    />

    {#if infoLoading && !bridgeInfo && !infoError}
      <!-- Loading State: Show a subtle loading indicator below topology -->
      <div class="loading-state">
        <p class="hint">{$t('dashboard.loading_bridge')}</p>
      </div>
    {:else if infoError}
      <!-- API Error State: Show retry button below topology -->
      <div class="error-action-container">
        <div class="error-buttons">
          <Button variant="primary" onclick={() => window.location.reload()}>
            {$t('common.retry')} ({autoReloadCountdown}s)
          </Button>
        </div>
      </div>
    {:else if !bridgeInfo}
      <!-- Empty State: No info but no error? -->
      <div class="empty-state">
        <p class="empty">{$t('dashboard.no_bridge_info')}</p>
      </div>
    {:else if hasCriticalError || bridgeInfo?.error}
      <!-- Critical Error or General Bridge Error -->
      {#if bridgeInfo.error && !hasCriticalError}
        <div class="bridge-error">
          <p class="error subtle">
            {$t('dashboard.bridge_error', { values: { error: getBridgeErrorMessage() } })}
          </p>
        </div>
      {/if}

      {#if hasCriticalError}
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
      {/if}
    {/if}

    <!-- Content Section (Activity & Entities) -->
    <!-- Only show if we have bridgeInfo and no critical error preventing operation -->
    {#if bridgeInfo && !hasCriticalError && !infoError}
      <!-- Recent Activity Section -->
      {#if activePortId}
        <RecentActivity activities={displayActivityLogs} />
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
        {/if}
        {#each searchedEntities as entity (entity.id + '-' + (entity.portId || 'unknown') + '-' + (entity.category || 'entity'))}
          {@const activity = getLastActivity(entity)}
          <EntityCard
            {entity}
            onSelect={() => handleSelect(entity.id, entity.portId, entity.category ?? 'entity')}
            lastActivityText={activity?.text}
            lastActivityTooltip={activity?.tooltip}
          />
        {/each}
        <button type="button" class="add-entity-card" onclick={openAddModal}>
          <span class="add-icon" aria-hidden="true">+</span>
          <span class="add-label">{$t('dashboard.add_card_label')}</span>
        </button>
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
    display: inline-flex;
    align-items: center;
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
    transition:
      width 0.2s ease,
      opacity 0.2s ease;
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
    display: flex;
    align-items: stretch;
  }

  .inactive-chip-wrapper .filter-chip {
    height: 100%;
  }

  .error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .yaml-editor-container {
    flex: 1;
    min-height: 200px;
    border: 1px solid #334155;
    border-radius: 4px;
    margin-bottom: 0;
  }

  :global(.yaml-editor-instance) {
    height: 100%;
    width: 100%;
  }

  .entity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .add-entity-card {
    border: 2px dashed rgba(148, 163, 184, 0.45);
    border-radius: 1rem;
    padding: 2rem;
    background: rgba(15, 23, 42, 0.45);
    color: #cbd5f5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 210px;
  }

  .add-entity-card:hover,
  .add-entity-card:focus-visible {
    border-color: rgba(129, 140, 248, 0.8);
    background: rgba(30, 41, 59, 0.7);
    color: #e2e8f0;
  }

  .add-icon {
    font-size: 2.5rem;
    font-weight: 600;
    line-height: 1;
  }

  .add-label {
    font-size: 0.95rem;
    font-weight: 600;
  }

  /* New Modal Styles */
  .modal-content-wrapper {
    position: relative;
    width: 100%;
    height: 85dvh;
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95));
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .modal-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    gap: 1.5rem;
    overflow-y: auto;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.15);
  }

  /* Specific Section Overrides */
  .add-modal-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .add-modal-section.full-height {
    flex: 1;
    min-height: 0;
  }

  .add-option-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 0.75rem;
  }

  .add-option-card {
    border-radius: 0.75rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(15, 23, 42, 0.65);
    color: #e2e8f0;
    text-align: left;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .add-option-card:hover,
  .add-option-card:focus-visible {
    border-color: rgba(59, 130, 246, 0.7);
    background: rgba(30, 41, 59, 0.8);
  }

  .add-option-card span {
    color: #94a3b8;
    font-size: 0.85rem;
  }

  .yaml-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .entity-type-badge {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .docs-link {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.8rem;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
    color: #cbd5e1;
    font-size: 0.85rem;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.2s ease;
  }

  .docs-link:hover {
    background: rgba(30, 41, 59, 0.8);
    border-color: rgba(148, 163, 184, 0.5);
    color: #f1f5f9;
  }

  .yaml-hint {
    color: #94a3b8;
    margin: 0.35rem 0 0;
    font-size: 0.9rem;
  }

  .copy-message {
    color: #38bdf8;
    margin: 0;
    font-size: 0.9rem;
    text-align: right;
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

  .section-header-with-desc {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .section-desc {
    color: #94a3b8;
    margin: 0;
    font-size: 0.9rem;
  }
</style>
