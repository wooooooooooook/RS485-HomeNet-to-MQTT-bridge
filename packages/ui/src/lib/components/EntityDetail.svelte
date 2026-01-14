<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { t } from 'svelte-i18n';
  import Button from './Button.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import Dialog from './Dialog.svelte';
  import Modal from './Modal.svelte';
  import ActivityLogList from './ActivityLogList.svelte';
  import { formatTime } from '../utils/time';
  import type {
    UnifiedEntity,
    CommandInfo,
    ParsedPacket,
    CommandPacket,
    EntityCategory,
    ActivityLog,
    EntityErrorEvent,
  } from '../types';

  let {
    entity,
    parsedPackets = [],
    commandPackets = [],
    activityLogs = [],
    entityErrors = [],
    isOpen,
    isRenaming = false,
    renameError = null,
    onClose,
    onExecute,
    onRename,
    onUpdate,
  }: {
    entity: UnifiedEntity;
    parsedPackets?: ParsedPacket[];
    commandPackets?: CommandPacket[];
    activityLogs?: ActivityLog[];
    entityErrors?: EntityErrorEvent[];
    isOpen: boolean;
    isRenaming?: boolean;
    renameError?: string | null;
    onClose?: () => void;
    onExecute?: (cmd: CommandInfo, value?: any) => void;
    onRename?: (newName: string) => void;
    onUpdate?: (updates: Partial<UnifiedEntity>) => void;
  } = $props();

  let activeTab = $state<'status' | 'config' | 'packets' | 'manage' | 'execute' | 'logs'>('status');
  let activeTabEntityId = $state<string | null>(null);
  let editingConfig = $state('');
  let configLoading = $state(false);
  let configError = $state<string | null>(null);
  let isSaving = $state(false);
  let saveMessage = $state('');
  let renameInput = $state('');
  let renameLocalError = $state<string | null>(null);
  let renameEntityId = $state<string | null>(null);
  let effectiveRenameError = $state('');
  let idCopied = $state(false);
  let isExecutingAutomation = $state(false);
  let isExecutingScript = $state(false);
  let executeMessage = $state('');
  let executeError = $state<string | null>(null);
  let isTogglingAutomation = $state(false);
  let automationToggleError = $state<string | null>(null);

  let isTogglingDiscoveryAlways = $state(false);
  let forceActiveError = $state<string | null>(null);

  let tabsContainer = $state<HTMLElement>();
  let commandInputs = $state<Record<string, any>>({});
  let executingCommands = $state(new Set<string>());

  let showRx = $state(true);
  let showTx = $state(true);

  const formatErrorContext = (context?: Record<string, unknown>) => {
    if (!context || Object.keys(context).length === 0) return '';
    try {
      return JSON.stringify(context);
    } catch {
      return '';
    }
  };

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
    onCancel: undefined as (() => void) | undefined,
  });

  const closeDialog = () => {
    if (dialog.onCancel) {
      dialog.onCancel();
    }
    dialog.open = false;
  };

  const showAlertDialog = (
    title: string,
    message: string,
    variant: 'danger' | 'success' = 'danger',
  ) => {
    dialog.title = title;
    dialog.message = message;
    dialog.variant = variant;
    dialog.showCancel = false;
    dialog.confirmText = $t('common.confirm');
    dialog.loading = false;
    dialog.onConfirm = async () => {
      closeDialog();
    };
    dialog.onCancel = undefined;
    dialog.open = true;
  };

  const showConfirmDialog = ({
    title,
    message,
    confirmText,
    variant = 'primary',
    loadingText,
    action,
    onSuccess,
    onCancel,
  }: {
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'primary' | 'danger' | 'success';
    loadingText?: string;
    action: () => Promise<void>;
    onSuccess?: () => void;
    onCancel?: () => void;
  }) => {
    dialog.title = title;
    dialog.message = message;
    dialog.confirmText = confirmText;
    dialog.variant = variant;
    dialog.loadingText = loadingText;
    dialog.showCancel = true;
    dialog.loading = false;
    dialog.onCancel = onCancel;
    dialog.onConfirm = async () => {
      dialog.loading = true;
      try {
        await action();
        // Reset onCancel so it's not called when closing on success
        dialog.onCancel = undefined;
        closeDialog();
        // Wait for close animation
        if (onSuccess) {
          setTimeout(onSuccess, 300);
        }
      } catch (err: any) {
        // Reset onCancel so it's not called when closing on error
        dialog.onCancel = undefined;
        closeDialog();
        setTimeout(() => {
          showAlertDialog(
            $t('common.error') || 'Error',
            err.message || 'An error occurred',
            'danger',
          );
        }, 300);
      } finally {
        dialog.loading = false;
      }
    };
    dialog.open = true;
  };

  const entityCategory = $derived.by<EntityCategory>(() => entity.category ?? 'entity');
  const isDeviceEntity = $derived.by(() => entityCategory === 'entity');
  const isAutomation = $derived.by(() => entityCategory === 'automation');
  const isScript = $derived.by(() => entityCategory === 'script');
  const logTitle = $derived.by(() => {
    if (isAutomation) return $t('entity_detail.automation.logs_title');
    if (isScript) return $t('entity_detail.script.logs_title');
    return $t('entity_detail.entity.logs_title');
  });
  const logEmptyMessage = $derived.by(() => {
    if (isAutomation) return $t('entity_detail.automation.logs_empty');
    if (isScript) return $t('entity_detail.script.logs_empty');
    return $t('entity_detail.entity.logs_empty');
  });

  type MergedPacket = ({ type: 'rx' } & ParsedPacket) | ({ type: 'tx' } & CommandPacket);

  const getTimestampMs = (packet: ParsedPacket | CommandPacket) =>
    packet.timestampMs ?? new Date(packet.timestamp).getTime();

  const mergePackets = (rxPackets: ParsedPacket[], txPackets: CommandPacket[]) => {
    const merged: MergedPacket[] = [];
    let rxIndex = 0;
    let txIndex = 0;

    while (rxIndex < rxPackets.length || txIndex < txPackets.length) {
      const rxPacket = rxPackets[rxIndex];
      const txPacket = txPackets[txIndex];
      const rxTimestamp = rxPacket ? getTimestampMs(rxPacket) : -Infinity;
      const txTimestamp = txPacket ? getTimestampMs(txPacket) : -Infinity;

      if (txPacket === undefined || (rxPacket && rxTimestamp >= txTimestamp)) {
        merged.push({ ...rxPacket, type: 'rx' } as const);
        rxIndex += 1;
      } else if (txPacket) {
        merged.push({ ...txPacket, type: 'tx' } as const);
        txIndex += 1;
      }
    }

    return merged;
  };

  const mergedPackets = $derived.by(() => {
    const rxPackets = showRx ? parsedPackets : [];
    const txPackets = showTx ? commandPackets : [];

    return mergePackets(rxPackets, txPackets);
  });

  // Use a variable to track the entity ID for which config was last loaded into the editor
  let loadedConfigEntityId = $state<string | null>(null);

  $effect(() => {
    if (entity && entity.id !== renameEntityId) {
      renameInput = entity.displayName;
      renameEntityId = entity.id;
      renameLocalError = null;
    }
  });

  $effect(() => {
    if (entity && entity.id !== activeTabEntityId) {
      activeTab = isDeviceEntity ? 'status' : 'execute';
      activeTabEntityId = entity.id;
      executeMessage = '';
      executeError = null;
    }
  });

  $effect(() => {
    effectiveRenameError = renameLocalError || renameError || '';
  });

  function handleRename() {
    const trimmed = renameInput.trim();

    if (!trimmed) {
      renameLocalError = $t('entity_detail.manage.rename.error_empty');
      return;
    }

    if (trimmed === entity.displayName) {
      renameLocalError = $t('entity_detail.manage.rename.error_same');
      return;
    }

    renameLocalError = null;
    onRename?.(trimmed);
  }

  function handleExecute(cmd: CommandInfo, value?: any) {
    const key = `${cmd.entityId}-${cmd.commandName}`;
    if (executingCommands.has(key)) return;

    executingCommands.add(key);
    executingCommands = new Set(executingCommands); // Trigger reactivity

    onExecute?.(cmd, value);

    // Optimistic loading state for UX feedback
    setTimeout(() => {
      executingCommands.delete(key);
      executingCommands = new Set(executingCommands);
    }, 500);
  }

  onMount(() => {
    // Initial load if modal is already open and entity is available (unlikely onMount but good practice)
    if (isOpen && entity && activeTab === 'config' && loadedConfigEntityId !== entity.id) {
      loadRawConfig();
      loadedConfigEntityId = entity.id;
    }
  });

  $effect(() => {
    if (isOpen && entity && activeTab === 'config') {
      // Only load config if a new entity is selected OR if we're switching to the config tab for a new entity
      if (loadedConfigEntityId !== entity.id) {
        loadRawConfig();
        loadedConfigEntityId = entity.id;
      }
    } else if (!isOpen) {
      // Reset loadedConfigEntityId when the modal is closed
      loadedConfigEntityId = null;
    }
  });

  // Re-initialize command inputs only when the entity.id changes or modal opens for a *new* entity
  $effect(() => {
    if (isOpen && entity && loadedConfigEntityId !== entity.id) {
      entity.commands.forEach((cmd: CommandInfo) => {
        if (cmd.inputType === 'number') {
          commandInputs[`${cmd.entityId}_${cmd.commandName}`] = cmd.min ?? 0;
        }
      });
    }
  });

  async function loadRawConfig() {
    configLoading = true;
    configError = null;
    saveMessage = '';
    try {
      const res = await fetch(`./api/config/raw/${entityCategory}/${entity.id}`);
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      editingConfig = data.yaml;
    } catch (err) {
      configError = $t('entity_detail.config.load_error');
    } finally {
      configLoading = false;
    }
  }

  async function handleRestart() {
    try {
      // 1. Get restart token
      const tokenRes = await fetch('./api/system/restart/token');
      if (!tokenRes.ok) {
        throw new Error('Failed to get restart token');
      }
      const { token } = await tokenRes.json();

      // 2. Trigger restart
      const restartRes = await fetch('./api/system/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!restartRes.ok) {
        const data = await restartRes.json();
        throw new Error(data.error || 'Restart failed');
      }

      // 3. Show success and reload (although the server might have already killed the process)
      showAlertDialog(
        $t('common.success') || 'Success',
        $t('entity_detail.config.restart_initiated') ||
          'Restart initiated. The page will reload shortly.',
        'success',
      );

      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (err) {
      console.error(err);
      showAlertDialog(
        $t('common.error') || 'Error',
        err instanceof Error ? err.message : 'Failed to restart',
        'danger',
      );
    }
  }

  function promptForRestart(onCancel?: () => void) {
    showConfirmDialog({
      title: $t('entity_detail.config.restart_title') || 'Restart Required',
      message:
        $t('entity_detail.config.restart_confirm') ||
        'Do you want to restart the bridge to apply changes?',
      confirmText: $t('entity_detail.config.restart_button') || 'Restart',
      variant: 'primary',
      action: async () => {
        await handleRestart();
      },
      onCancel,
    });
  }

  async function saveConfig() {
    if (!editingConfig) return;

    isSaving = true;
    configError = null;
    saveMessage = '';

    try {
      const res = await fetch('./api/config/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityId: entity.id,
          yaml: editingConfig,
          portId: entity.portId,
          type: entityCategory,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || $t('entity_detail.config.save_error'));
      }

      saveMessage = $t('entity_detail.config.save_success', { values: { backup: data.backup } });

      promptForRestart();
    } catch (err) {
      configError = err instanceof Error ? err.message : $t('entity_detail.config.save_error');
    } finally {
      isSaving = false;
    }
  }

  function handleRevokeDiscovery() {
    showConfirmDialog({
      title: $t('entity_detail.manage.revoke.title'),
      message: $t('entity_detail.manage.revoke.confirm'),
      confirmText: $t('entity_detail.manage.revoke.button'),
      variant: 'danger',
      action: async () => {
        const res = await fetch(`./api/entities/${entity.id}/revoke-discovery`, { method: 'POST' });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || $t('entity_detail.manage.revoke.error'));
        }
      },
      onSuccess: () => {
        showAlertDialog(
          $t('common.success') || 'Success',
          $t('entity_detail.manage.revoke.success'),
          'success',
        );
      },
    });
  }

  function handleDeleteEntity() {
    showConfirmDialog({
      title: $t('entity_detail.manage.delete.title'),
      message: $t('entity_detail.manage.delete.confirm'),
      confirmText: $t('entity_detail.manage.delete.button'),
      variant: 'danger',
      action: async () => {
        const deleteUrl = entity.portId
          ? `./api/entities/${entity.id}?portId=${encodeURIComponent(entity.portId)}`
          : `./api/entities/${entity.id}`;
        const res = await fetch(deleteUrl, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || $t('entity_detail.manage.delete.error'));
        }
      },
      onSuccess: () => {
        promptForRestart(() => {
          // On cancel of restart, close the entity detail modal because the entity is gone
          close();
        });
      },
    });
  }

  async function handleExecuteAutomation() {
    if (isExecutingAutomation) return;
    isExecutingAutomation = true;
    executeMessage = '';
    executeError = null;

    try {
      const res = await fetch('./api/automations/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ automationId: entity.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.execute.error'));
      }
      executeMessage = $t('entity_detail.automation.execute_success');
    } catch (err) {
      executeError = err instanceof Error ? err.message : $t('entity_detail.execute.error');
    } finally {
      isExecutingAutomation = false;
    }
  }

  async function handleExecuteScript() {
    if (isExecutingScript) return;
    isExecutingScript = true;
    executeMessage = '';
    executeError = null;

    try {
      const res = await fetch('./api/scripts/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: entity.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.execute.error'));
      }
      executeMessage = $t('entity_detail.script.execute_success');
    } catch (err) {
      executeError = err instanceof Error ? err.message : $t('entity_detail.execute.error');
    } finally {
      isExecutingScript = false;
    }
  }

  async function handleToggleAutomationEnabled(newValue: boolean) {
    // No optimistic update - wait for restart
    isTogglingAutomation = true;
    automationToggleError = null;

    try {
      const res = await fetch(`./api/automations/${entity.id}/enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newValue }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.automation.toggle_error'));
      }

      promptForRestart();
    } catch (err) {
      automationToggleError =
        err instanceof Error ? err.message : $t('entity_detail.automation.toggle_error');
    } finally {
      isTogglingAutomation = false;
    }
  }

  function handleDeleteAutomation() {
    showConfirmDialog({
      title: $t('entity_detail.automation.delete_title'),
      message: $t('entity_detail.automation.delete_confirm'),
      confirmText: $t('entity_detail.automation.delete_button'),
      variant: 'danger',
      action: async () => {
        const res = await fetch(`./api/automations/${entity.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || $t('entity_detail.automation.delete_error'));
        }
      },
      onSuccess: () => {
        close();
        window.location.reload();
      },
    });
  }

  function handleDeleteScript() {
    showConfirmDialog({
      title: $t('entity_detail.script.delete_title'),
      message: $t('entity_detail.script.delete_confirm'),
      confirmText: $t('entity_detail.script.delete_button'),
      variant: 'danger',
      action: async () => {
        const res = await fetch(`./api/scripts/${entity.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || $t('entity_detail.script.delete_error'));
        }
      },
      onSuccess: () => {
        close();
        window.location.reload();
      },
    });
  }

  async function handleToggleDiscoveryAlways(newValue: boolean) {
    const oldValue = entity.discoveryAlways;
    // Optimistic update
    entity.discoveryAlways = newValue;

    isTogglingDiscoveryAlways = true;
    forceActiveError = null;

    try {
      const res = await fetch(`./api/entities/${entity.id}/discovery-always`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: newValue,
          portId: entity.portId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.manage.force_active.error'));
      }

      onUpdate?.({ discoveryAlways: newValue });

      promptForRestart();
    } catch (err) {
      forceActiveError =
        err instanceof Error ? err.message : $t('entity_detail.manage.force_active.error');
      // Revert on error
      entity.discoveryAlways = oldValue;
    } finally {
      isTogglingDiscoveryAlways = false;
    }
  }

  function close() {
    onClose?.();
  }

  function parsePayload(payload?: string) {
    if (!payload) return [];
    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed).map(([key, value]) => ({ key, value }));
      }
    } catch (e) {
      // ignore
    }
    return [{ key: 'Raw', value: payload }];
  }

  async function handleCopyId() {
    try {
      await navigator.clipboard.writeText(entity.id);
      idCopied = true;
      setTimeout(() => (idCopied = false), 2000);
    } catch (err) {
      console.error('Failed to copy ID', err);
    }
  }

  function handleTabKeydown(e: KeyboardEvent) {
    if (!tabsContainer) return;
    const tabs = Array.from(tabsContainer.querySelectorAll('[role="tab"]')) as HTMLElement[];
    if (tabs.length === 0) return;

    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;

    let nextIndex = index;

    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  }
</script>

<Modal open={isOpen} width="1400px" onclose={close} oncancel={close}>
  <div class="modal-content-wrapper">
    <header class="modal-header">
      <div class="header-info">
        <h2 id="modal-title">{entity.displayName}</h2>
        <button
          class="entity-id-btn"
          onclick={handleCopyId}
          title={$t('entity_detail.copy_id') || 'Click to copy ID'}
          aria-label={$t('entity_detail.copy_id_aria', { values: { id: entity.id } }) ||
            `Copy ID ${entity.id}`}
        >
          <span class="entity-id">{entity.id}</span>
          {#if idCopied}
            <span
              class="copy-feedback"
              role="status"
              aria-live="polite"
              transition:fade={{ duration: 200 }}>{$t('common.copied') || 'Copied!'}</span
            >
          {/if}
        </button>
      </div>
      <button class="close-btn" onclick={close} aria-label={$t('entity_detail.close_aria')}
        >&times;</button
      >
    </header>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="modal-tabs"
      role="tablist"
      tabindex="-1"
      bind:this={tabsContainer}
      onkeydown={handleTabKeydown}
    >
      {#if isDeviceEntity}
        <button
          role="tab"
          id="tab-status"
          aria-selected={activeTab === 'status'}
          aria-controls="panel-status"
          tabindex={activeTab === 'status' ? 0 : -1}
          class:active={activeTab === 'status'}
          onclick={() => (activeTab = 'status')}>{$t('entity_detail.tabs.status')}</button
        >
      {:else}
        <button
          role="tab"
          id="tab-execute"
          aria-selected={activeTab === 'execute'}
          aria-controls="panel-execute"
          tabindex={activeTab === 'execute' ? 0 : -1}
          class:active={activeTab === 'execute'}
          onclick={() => (activeTab = 'execute')}>{$t('entity_detail.tabs.execute')}</button
        >
      {/if}
      <button
        role="tab"
        id="tab-config"
        aria-selected={activeTab === 'config'}
        aria-controls="panel-config"
        tabindex={activeTab === 'config' ? 0 : -1}
        class:active={activeTab === 'config'}
        onclick={() => (activeTab = 'config')}>{$t('entity_detail.tabs.config')}</button
      >
      <button
        role="tab"
        id="tab-logs"
        aria-selected={activeTab === 'logs'}
        aria-controls="panel-logs"
        tabindex={activeTab === 'logs' ? 0 : -1}
        class:active={activeTab === 'logs'}
        onclick={() => (activeTab = 'logs')}>{$t('entity_detail.tabs.logs')}</button
      >
      {#if isDeviceEntity}
        <button
          role="tab"
          id="tab-packets"
          aria-selected={activeTab === 'packets'}
          aria-controls="panel-packets"
          tabindex={activeTab === 'packets' ? 0 : -1}
          class:active={activeTab === 'packets'}
          onclick={() => (activeTab = 'packets')}>{$t('entity_detail.tabs.packets')}</button
        >
      {/if}
      <button
        role="tab"
        id="tab-manage"
        aria-selected={activeTab === 'manage'}
        aria-controls="panel-manage"
        tabindex={activeTab === 'manage' ? 0 : -1}
        class:active={activeTab === 'manage'}
        onclick={() => (activeTab = 'manage')}>{$t('entity_detail.tabs.manage')}</button
      >
    </div>

    <div class="modal-body">
      {#if activeTab === 'status'}
        <div role="tabpanel" id="panel-status" aria-labelledby="tab-status" tabindex="0">
          <div class="section status-section">
            <h3>{$t('entity_detail.status.title')}</h3>
            <div class="payload-list">
              {#each parsePayload(entity.statePayload) as item (item.key)}
                <div class="payload-item">
                  <span class="payload-key">{item.key}</span>
                  <span class="payload-value">{item.value}</span>
                </div>
              {/each}
              {#if !entity.statePayload}
                <div class="no-data">{$t('entity_detail.status.no_data')}</div>
              {/if}
            </div>
          </div>

          {#if entity.commands.length > 0}
            <div class="section command-section">
              <h3>{$t('entity_detail.status.command_title')}</h3>
              <div class="command-grid">
                {#each entity.commands as cmd (`${cmd.entityId}-${cmd.commandName}`)}
                  <div class="command-item">
                    {#if cmd.inputType === 'number'}
                      <div class="input-group">
                        <label for={`cmd-${cmd.entityId}-${cmd.commandName}`}
                          >{cmd.commandName.replace('command_', '')}</label
                        >
                        <input
                          id={`cmd-${cmd.entityId}-${cmd.commandName}`}
                          type="number"
                          min={cmd.min}
                          max={cmd.max}
                          step={cmd.step}
                          bind:value={commandInputs[`${cmd.entityId}_${cmd.commandName}`]}
                        />
                        <Button
                          variant="primary"
                          onclick={() =>
                            handleExecute(cmd, commandInputs[`${cmd.entityId}_${cmd.commandName}`])}
                          isLoading={executingCommands.has(`${cmd.entityId}-${cmd.commandName}`)}
                          ariaLabel={$t('entity_detail.status.send_aria', {
                            values: { command: cmd.displayName },
                          })}
                        >
                          {$t('entity_detail.status.send')}
                        </Button>
                      </div>
                    {:else}
                      <Button
                        variant="secondary"
                        fullWidth
                        class="cmd-btn"
                        onclick={() => handleExecute(cmd)}
                        isLoading={executingCommands.has(`${cmd.entityId}-${cmd.commandName}`)}
                      >
                        {cmd.displayName}
                      </Button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else if activeTab === 'execute'}
        <div role="tabpanel" id="panel-execute" aria-labelledby="tab-execute" tabindex="0">
          <div class="section status-section">
            {#if isAutomation}
              <h3>{$t('entity_detail.automation.execute_title')}</h3>
              <p class="subtle">{$t('entity_detail.automation.execute_desc')}</p>
              <Button
                variant="primary"
                onclick={handleExecuteAutomation}
                isLoading={isExecutingAutomation}
              >
                {$t('entity_detail.automation.execute_button')}
              </Button>
            {:else if isScript}
              <h3>{$t('entity_detail.script.execute_title')}</h3>
              <p class="subtle">{$t('entity_detail.script.execute_desc')}</p>
              <Button variant="primary" onclick={handleExecuteScript} isLoading={isExecutingScript}>
                {$t('entity_detail.script.execute_button')}
              </Button>
            {/if}
            {#if executeMessage}
              <div class="save-message success">{executeMessage}</div>
            {/if}
            {#if executeError}
              <div class="save-message error">{executeError}</div>
            {/if}
          </div>
        </div>
      {:else if activeTab === 'config'}
        <div role="tabpanel" id="panel-config" aria-labelledby="tab-config" tabindex="0">
          <div class="section config-section">
            {#if configLoading}
              <div class="loading">{$t('entity_detail.config.loading')}</div>
            {:else}
              <div class="config-editor-container">
                <textarea class="config-editor" bind:value={editingConfig} spellcheck="false"
                ></textarea>
                <div class="config-actions">
                  <Button
                    variant="success"
                    onclick={saveConfig}
                    isLoading={isSaving}
                    ariaLabel={isSaving
                      ? $t('entity_detail.config.saving')
                      : $t('entity_detail.config.save')}
                  >
                    {$t('entity_detail.config.save')}
                  </Button>
                  {#if saveMessage}
                    <span class="save-message success">{saveMessage}</span>
                  {/if}
                  {#if configError}
                    <span class="save-message error">{configError}</span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        </div>
      {:else if activeTab === 'packets'}
        <div role="tabpanel" id="panel-packets" aria-labelledby="tab-packets" tabindex="0">
          <div class="section packet-log-section">
            <div class="log-header">
              <div class="header-left">
                <h4>{$t('entity_detail.packets.title')}</h4>
                <div class="filters">
                  <label>
                    <input type="checkbox" bind:checked={showRx} />
                    {$t('entity_detail.packets.rx_label')}
                  </label>
                  <label>
                    <input type="checkbox" bind:checked={showTx} />
                    {$t('entity_detail.packets.tx_label')}
                  </label>
                </div>
              </div>
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div
              class="log-list unified-list"
              role="log"
              tabindex="0"
              aria-label={$t('entity_detail.packets.title')}
            >
              {#if mergedPackets.length === 0}
                <div class="no-data">{$t('entity_detail.packets.no_packets')}</div>
              {:else}
                {#each mergedPackets as packet, index (`${packet.type}-${packet.timestamp}-${index}`)}
                  <div class="log-entry {packet.type}">
                    <span class="time">
                      {packet.timeLabel ?? formatTime(packet.timestamp)}
                    </span>

                    {#if packet.type === 'rx'}
                      <span class="direction rx">RX</span>
                      <span class="entity">{packet.entityId}</span>
                      <span class="payload">{packet.packet.toUpperCase()}</span>
                      {#if packet.state}
                        <span class="state-preview">→ {JSON.stringify(packet.state)}</span>
                      {/if}
                    {:else}
                      <span class="direction tx">TX</span>
                      <span class="entity">{packet.entityId}</span>
                      <span class="payload">{packet.packet.toUpperCase()}</span>
                      <span class="command-info">
                        {packet.command}
                        {#if packet.value !== undefined}<span class="value">({packet.value})</span
                          >{/if}
                      </span>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        </div>
      {:else if activeTab === 'logs'}
        <div role="tabpanel" id="panel-logs" aria-labelledby="tab-logs" tabindex="0">
          <div class="section error-section">
            <h3>{$t('entity_detail.errors.title')}</h3>
            {#if entityErrors.length === 0}
              <div class="no-data">{$t('entity_detail.errors.empty')}</div>
            {:else}
              <div class="error-list" role="list">
                {#each entityErrors as error (error.timestamp)}
                  <div class="error-entry" role="listitem">
                    <div class="error-meta">
                      <span class="error-time">{formatTime(error.timestamp)}</span>
                      <span class="error-type">{$t(`entity_detail.errors.types.${error.type}`)}</span>
                    </div>
                    <div class="error-message">{error.message}</div>
                    {#if formatErrorContext(error.context)}
                      <div class="error-context">{formatErrorContext(error.context)}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          <div class="section">
            <ActivityLogList
              logs={activityLogs}
              title={logTitle}
              emptyMessage={logEmptyMessage}
              height="260px"
            />
          </div>
        </div>
      {:else if activeTab === 'manage'}
        <div role="tabpanel" id="panel-manage" aria-labelledby="tab-manage" tabindex="0">
          {#if isDeviceEntity}
            <div class="section manage-card">
              <h3>{$t('entity_detail.manage.rename.title')}</h3>
              <p class="subtle">{$t('entity_detail.manage.rename.desc')}</p>
              <div class="rename-form">
                <input
                  type="text"
                  bind:value={renameInput}
                  placeholder={$t('entity_detail.manage.rename.placeholder')}
                  aria-label={$t('entity_detail.manage.rename.placeholder')}
                  oninput={() => (renameLocalError = null)}
                />
                <Button
                  variant="success"
                  onclick={handleRename}
                  isLoading={isRenaming}
                  ariaLabel={isRenaming
                    ? $t('entity_detail.manage.rename.saving')
                    : $t('entity_detail.manage.rename.save')}
                >
                  {$t('entity_detail.manage.rename.save')}
                </Button>
              </div>
              {#if effectiveRenameError}
                <div class="rename-error">{effectiveRenameError}</div>
              {/if}
            </div>

            {#if entity.isActive}
              <div class="section manage-card">
                <h3>{$t('entity_detail.manage.revoke.title')}</h3>
                <p class="subtle">
                  {@html $t('entity_detail.manage.revoke.desc')}
                </p>
                <Button variant="secondary" onclick={handleRevokeDiscovery}>
                  {$t('entity_detail.manage.revoke.button')}
                </Button>
              </div>
            {/if}

            {#if !entity.isActive || entity.discoveryAlways}
              <div class="section manage-card">
                <div class="toggle-row">
                  <div class="toggle-info">
                    <h3 id="force-active-title">
                      {$t('entity_detail.manage.force_active.title')}
                    </h3>
                    <p class="subtle">{$t('entity_detail.manage.force_active.desc')}</p>
                  </div>
                  <Toggle
                    checked={entity.discoveryAlways ?? false}
                    onchange={handleToggleDiscoveryAlways}
                    disabled={isTogglingDiscoveryAlways}
                    ariaLabelledBy="force-active-title"
                  />
                </div>
                {#if forceActiveError}
                  <div class="rename-error">{forceActiveError}</div>
                {/if}
              </div>
            {/if}
            <div class="section manage-card danger-zone">
              <h3>{$t('entity_detail.manage.delete.title')}</h3>
              <p class="subtle">
                {@html $t('entity_detail.manage.delete.desc')}
              </p>
              <Button variant="danger" onclick={handleDeleteEntity}>
                {$t('entity_detail.manage.delete.button')}
              </Button>
            </div>
          {:else if isAutomation}
            <div class="section manage-card">
              <div class="toggle-row">
                <div class="toggle-info">
                  <h3 id="automation-toggle-title">
                    {$t('entity_detail.automation.toggle_title')}
                  </h3>
                  <p class="subtle">{$t('entity_detail.automation.toggle_desc')}</p>
                </div>
                <Toggle
                  checked={entity.enabled ?? true}
                  onchange={handleToggleAutomationEnabled}
                  disabled={isTogglingAutomation}
                  ariaLabelledBy="automation-toggle-title"
                />
              </div>
              {#if automationToggleError}
                <div class="rename-error">{automationToggleError}</div>
              {/if}
            </div>
            <div class="section manage-card danger-zone">
              <h3>{$t('entity_detail.automation.delete_title')}</h3>
              <p class="subtle">{$t('entity_detail.automation.delete_desc')}</p>
              <Button variant="danger" onclick={handleDeleteAutomation}>
                {$t('entity_detail.automation.delete_button')}
              </Button>
            </div>
          {:else if isScript}
            <div class="section manage-card danger-zone">
              <h3>{$t('entity_detail.script.delete_title')}</h3>
              <p class="subtle">{$t('entity_detail.script.delete_desc')}</p>
              <Button variant="danger" onclick={handleDeleteScript}>
                {$t('entity_detail.script.delete_button')}
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</Modal>

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

<style>
  .modal-content-wrapper {
    background: #1e293b;
    display: flex;
    flex-direction: column;
    height: 85dvh;
    overflow: hidden;
  }

  .modal-header {
    padding: 1.5rem;
    border-bottom: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: #0f172a;
  }

  .header-info h2 {
    margin: 0;
    color: #f1f5f9;
    font-size: 1.5rem;
  }

  .entity-id {
    color: #94a3b8;
    font-family: monospace;
    font-size: 0.9rem;
    margin-top: 0.25rem;
    display: block;
    transition: color 0.2s;
  }

  .entity-id-btn {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    text-align: left;
    display: block;
    position: relative;
  }

  .entity-id-btn:hover .entity-id {
    color: #38bdf8;
    text-decoration: underline;
    text-decoration-style: dotted;
  }

  .copy-feedback {
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translateY(-50%);
    margin-left: 0.5rem;
    background: #10b981;
    color: white;
    font-size: 0.75rem;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    font-weight: 500;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    transition: color 0.2s;
  }

  .close-btn:hover {
    color: #fff;
  }

  .modal-tabs {
    display: flex;
    background: #0f172a;
    padding: 0 1.5rem;
    border-bottom: 1px solid #334155;
    gap: 1rem;
  }

  .modal-tabs button {
    background: none;
    border: none;
    padding: 1rem 0.5rem;
    color: #94a3b8;
    cursor: pointer;
    font-size: 0.95rem;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .modal-tabs button:hover {
    color: #e2e8f0;
  }

  .modal-tabs button.active {
    color: #38bdf8;
    border-bottom-color: #38bdf8;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .section {
    margin-bottom: 2rem;
  }

  h3 {
    margin: 0 0 1rem 0;
    color: #e2e8f0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .subtle {
    margin: 0.5rem 0;
    color: #94a3b8;
    font-size: 0.9rem;
  }

  .rename-form {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .rename-form input {
    flex: 1;
    padding: 0.75rem 1rem;
    border-radius: 8px;
    border: 1px solid #334155;
    background: #0b1220;
    color: #e2e8f0;
    font-size: 1rem;
  }

  .rename-form input:focus {
    outline: none;
    border-color: #38bdf8;
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
  }

  .rename-error {
    margin-top: 0.5rem;
    color: #f87171;
    font-size: 0.9rem;
  }

  .payload-list {
    background: #0f172a;
    border-radius: 8px;
    border: 1px solid #334155;
    overflow: hidden;
  }

  .payload-item {
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #334155;
  }

  .payload-item:last-child {
    border-bottom: none;
  }

  .payload-key {
    color: #94a3b8;
  }

  .payload-value {
    color: #fff;
    font-weight: 500;
  }

  .command-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  /* .action-btn class is replaced by Button component, but might be used by other parts, so keeping it or removing if unused */
  /* Replaced by Button component usage, so this style block is less relevant for the buttons but kept for safety if used elsewhere or similar structures */

  .input-group {
    display: flex;
    height: 60px; /* Match standard button height */
    box-sizing: border-box;
    gap: 0.5rem;
    background: #334155;
    padding: 0.75rem;
    border-radius: 6px;
    border: 1px solid #475569;
    align-items: center;
    color: #fff;
  }

  .input-group label {
    font-size: 0.9rem;
    color: #fff;
    flex: 1;
    font-weight: 500;
  }

  .input-group input {
    background: #1e293b;
    border: 1px solid #475569;
    color: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    width: 60px;
    font-size: 0.9rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  /* Button overrides for specific layout needs in input group */
  :global(.input-group .btn) {
    padding: 0.25rem 0.75rem;
    font-size: 0.85rem;
    height: auto;
  }

  :global(.cmd-btn) {
    height: 60px; /* Ensure full height for grid items */
  }

  .config-editor-container {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
  }

  .config-editor {
    flex: 1;
    background: #0f172a;
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid #334155;
    color: #e2e8f0;
    font-family: 'Fira Code', monospace;
    font-size: 0.9rem;
    line-height: 1.5;
    resize: vertical;
    min-height: 400px;
    outline: none;
  }

  .config-editor:focus {
    border-color: #38bdf8;
  }

  .config-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .save-message {
    font-size: 0.9rem;
  }

  .save-message.success {
    color: #34d399;
  }

  .save-message.error {
    color: #f87171;
  }

  /* Unified Log Styles */
  .log-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .filters {
    display: flex;
    gap: 1rem;
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .filters label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
  }

  .filters input {
    cursor: pointer;
  }

  .log-list {
    flex: 1;
    overflow-y: auto;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 0.5rem;
    max-height: 500px; /* Limit height */
  }

  .log-entry {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #1e293b;
    font-size: 0.85rem;
    font-family: monospace;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: #cbd5e1;
  }

  .log-entry:last-child {
    border-bottom: none;
  }

  .log-entry .time {
    color: #64748b;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .direction {
    font-weight: bold;
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    width: 24px;
    text-align: center;
  }

  .direction.rx {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
  }

  .direction.tx {
    background: rgba(245, 158, 11, 0.2);
    color: #f59e0b;
  }

  .payload {
    color: #10b981;
    font-weight: 600;
    font-family: monospace;
  }

  .command-info {
    color: #a855f7;
    margin-left: 0.5rem;
  }

  .value {
    color: #ec4899;
  }

  .state-preview {
    color: #38bdf8;
    font-size: 0.85em;
    margin-left: 0.5rem;
    opacity: 0.9;
  }

  .no-data {
    padding: 2rem;
    text-align: center;
    color: #475569;
    font-style: italic;
  }

  .error-section {
    margin-bottom: 1.5rem;
  }

  .error-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 220px;
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .error-entry {
    border: 1px solid rgba(248, 113, 113, 0.4);
    background: rgba(239, 68, 68, 0.08);
    border-radius: 10px;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .error-meta {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    font-size: 0.85rem;
    color: rgba(248, 113, 113, 0.9);
  }

  .error-type {
    background: rgba(248, 113, 113, 0.15);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .error-message {
    font-size: 0.95rem;
    color: #fecaca;
    word-break: break-word;
  }

  .error-context {
    font-size: 0.8rem;
    color: rgba(226, 232, 240, 0.75);
    background: rgba(15, 23, 42, 0.6);
    padding: 0.35rem 0.5rem;
    border-radius: 8px;
    word-break: break-word;
  }

  /* Manage Tab Styles */
  .manage-card {
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 10px;
    padding: 1.5rem;
  }

  .manage-card h3 {
    margin-bottom: 0.5rem;
  }

  .manage-card .subtle {
    margin-bottom: 1rem;
  }

  .manage-card .rename-form {
    margin-top: 1rem;
  }

  .danger-zone {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.05);
  }

  .danger-zone h3 {
    color: #f87171;
  }

  .toggle-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .toggle-info {
    flex: 1;
  }

  .toggle-info h3 {
    margin-bottom: 0.25rem;
  }

  .toggle-info .subtle {
    margin-bottom: 0;
  }

  @media (max-width: 768px) {
    .modal-content-wrapper {
      border-radius: 0;
    }

    .modal-header {
      padding: 1rem;
    }

    .modal-tabs {
      padding: 0 1rem;
      overflow-x: auto; /* Ensure tabs are scrollable if they overflow */
    }

    .modal-body {
      padding: 1rem;
    }

    .manage-card {
      padding: 1rem;
    }
  }
</style>
