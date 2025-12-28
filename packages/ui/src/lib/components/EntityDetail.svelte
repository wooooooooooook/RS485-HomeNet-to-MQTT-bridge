<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { t } from 'svelte-i18n';
  import Button from './Button.svelte';
  import ActivityLogList from './ActivityLogList.svelte';
  import type {
    UnifiedEntity,
    CommandInfo,
    ParsedPacket,
    CommandPacket,
    EntityCategory,
    ActivityLog,
  } from '../types';

  let {
    entity,
    parsedPackets = [],
    commandPackets = [],
    activityLogs = [],
    isOpen,
    isRenaming = false,
    renameError = null,
    onClose,
    onExecute,
    onRename,
  }: {
    entity: UnifiedEntity;
    parsedPackets?: ParsedPacket[];
    commandPackets?: CommandPacket[];
    activityLogs?: ActivityLog[];
    isOpen: boolean;
    isRenaming?: boolean;
    renameError?: string | null;
    onClose?: () => void;
    onExecute?: (cmd: CommandInfo, value?: any) => void;
    onRename?: (newName: string) => void;
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

  let commandInputs = $state<Record<string, any>>({});
  let executingCommands = $state(new Set<string>());

  let showRx = $state(true);
  let showTx = $state(true);

  const entityCategory = $derived.by<EntityCategory>(() => entity.category ?? 'entity');
  const isDeviceEntity = $derived.by(() => entityCategory === 'entity');
  const isAutomation = $derived.by(() => entityCategory === 'automation');
  const isScript = $derived.by(() => entityCategory === 'script');
  const logTitle = $derived.by(() =>
    isAutomation
      ? $t('entity_detail.automation.logs_title')
      : $t('entity_detail.script.logs_title'),
  );
  const logEmptyMessage = $derived.by(() =>
    isAutomation
      ? $t('entity_detail.automation.logs_empty')
      : $t('entity_detail.script.logs_empty'),
  );

  type MergedPacket = ({ type: 'rx' } & ParsedPacket) | ({ type: 'tx' } & CommandPacket);

  const mergedPackets = $derived.by(() => {
    let packets: MergedPacket[] = [];

    if (showRx) {
      packets = packets.concat(
        parsedPackets.map((p: ParsedPacket) => ({ ...p, type: 'rx' }) as const),
      );
    }
    if (showTx) {
      packets = packets.concat(
        commandPackets.map((p: CommandPacket) => ({ ...p, type: 'tx' }) as const),
      );
    }

    return packets.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
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
    } catch (err) {
      configError = err instanceof Error ? err.message : $t('entity_detail.config.save_error');
    } finally {
      isSaving = false;
    }
  }

  async function handleRevokeDiscovery() {
    if (!confirm($t('entity_detail.manage.revoke.confirm'))) return;

    try {
      const res = await fetch(`./api/entities/${entity.id}/revoke-discovery`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.manage.revoke.error'));
      }
      alert($t('entity_detail.manage.revoke.success'));
    } catch (e) {
      alert(e instanceof Error ? e.message : $t('entity_detail.manage.revoke.error'));
    }
  }

  async function handleDeleteEntity() {
    if (!confirm($t('entity_detail.manage.delete.confirm'))) return;

    try {
      const deleteUrl = entity.portId
        ? `./api/entities/${entity.id}?portId=${encodeURIComponent(entity.portId)}`
        : `./api/entities/${entity.id}`;
      const res = await fetch(deleteUrl, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.manage.delete.error'));
      }
      alert($t('entity_detail.manage.delete.success'));
      close();
      window.location.reload(); // Reload to refresh entity list since it's a major change
    } catch (e) {
      alert(e instanceof Error ? e.message : $t('entity_detail.manage.delete.error'));
    }
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

  async function handleToggleAutomationEnabled(e: Event) {
    const target = e.target as HTMLInputElement;
    const newValue = target.checked;

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
      entity.enabled = newValue;
    } catch (err) {
      automationToggleError =
        err instanceof Error ? err.message : $t('entity_detail.automation.toggle_error');
      target.checked = !newValue;
    } finally {
      isTogglingAutomation = false;
    }
  }

  async function handleDeleteAutomation() {
    if (!confirm($t('entity_detail.automation.delete_confirm'))) return;

    try {
      const res = await fetch(`./api/automations/${entity.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.automation.delete_error'));
      }
      alert($t('entity_detail.automation.delete_success'));
      close();
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : $t('entity_detail.automation.delete_error'));
    }
  }

  async function handleDeleteScript() {
    if (!confirm($t('entity_detail.script.delete_confirm'))) return;

    try {
      const res = await fetch(`./api/scripts/${entity.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || $t('entity_detail.script.delete_error'));
      }
      alert($t('entity_detail.script.delete_success'));
      close();
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : $t('entity_detail.script.delete_error'));
    }
  }

  async function handleToggleDiscoveryAlways(e: Event) {
    const target = e.target as HTMLInputElement;
    const newValue = target.checked;

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

      // Update local entity state (for UI reactivity)
      entity.discoveryAlways = newValue;
    } catch (err) {
      forceActiveError =
        err instanceof Error ? err.message : $t('entity_detail.manage.force_active.error');
      // Revert checkbox state on error
      target.checked = !newValue;
    } finally {
      isTogglingDiscoveryAlways = false;
    }
  }

  function close() {
    onClose?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
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
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div
    class="overlay"
    onclick={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    transition:fade={{ duration: 200 }}
    role="button"
    tabindex="0"
    onkeydown={handleKeydown}
    aria-label={$t('entity_detail.close_aria')}
  >
    <div
      class="modal"
      transition:scale={{ duration: 200, start: 0.95 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
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
              <span class="copy-feedback" transition:fade={{ duration: 200 }}
                >{$t('common.copied') || 'Copied!'}</span
              >
            {/if}
          </button>
        </div>
        <button class="close-btn" onclick={close} aria-label={$t('entity_detail.close_aria')}
          >&times;</button
        >
      </header>

      <div class="modal-tabs" role="tablist">
        {#if isDeviceEntity}
          <button
            role="tab"
            id="tab-status"
            aria-selected={activeTab === 'status'}
            aria-controls="panel-status"
            class:active={activeTab === 'status'}
            onclick={() => (activeTab = 'status')}>{$t('entity_detail.tabs.status')}</button
          >
        {:else}
          <button
            role="tab"
            id="tab-execute"
            aria-selected={activeTab === 'execute'}
            aria-controls="panel-execute"
            class:active={activeTab === 'execute'}
            onclick={() => (activeTab = 'execute')}>{$t('entity_detail.tabs.execute')}</button
          >
        {/if}
        <button
          role="tab"
          id="tab-config"
          aria-selected={activeTab === 'config'}
          aria-controls="panel-config"
          class:active={activeTab === 'config'}
          onclick={() => (activeTab = 'config')}>{$t('entity_detail.tabs.config')}</button
        >
        {#if isAutomation || isScript}
          <button
            role="tab"
            id="tab-logs"
            aria-selected={activeTab === 'logs'}
            aria-controls="panel-logs"
            class:active={activeTab === 'logs'}
            onclick={() => (activeTab = 'logs')}>{$t('entity_detail.tabs.logs')}</button
          >
        {/if}
        {#if isDeviceEntity}
          <button
            role="tab"
            id="tab-packets"
            aria-selected={activeTab === 'packets'}
            aria-controls="panel-packets"
            class:active={activeTab === 'packets'}
            onclick={() => (activeTab = 'packets')}>{$t('entity_detail.tabs.packets')}</button
          >
        {/if}
        <button
          role="tab"
          id="tab-manage"
          aria-selected={activeTab === 'manage'}
          aria-controls="panel-manage"
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
                              handleExecute(
                                cmd,
                                commandInputs[`${cmd.entityId}_${cmd.commandName}`],
                              )}
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
                <Button
                  variant="primary"
                  onclick={handleExecuteScript}
                  isLoading={isExecutingScript}
                >
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
                      <span class="time">{new Date(packet.timestamp).toLocaleTimeString()}</span>

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
                      <h3>{$t('entity_detail.manage.force_active.title')}</h3>
                      <p class="subtle">{$t('entity_detail.manage.force_active.desc')}</p>
                    </div>
                    <label class="toggle-switch">
                      <input
                        type="checkbox"
                        checked={entity.discoveryAlways ?? false}
                        onchange={handleToggleDiscoveryAlways}
                        disabled={isTogglingDiscoveryAlways}
                      />
                      <span class="toggle-slider"></span>
                    </label>
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
                    <h3>{$t('entity_detail.automation.toggle_title')}</h3>
                    <p class="subtle">{$t('entity_detail.automation.toggle_desc')}</p>
                  </div>
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      checked={entity.enabled ?? true}
                      onchange={handleToggleAutomationEnabled}
                      disabled={isTogglingAutomation}
                    />
                    <span class="toggle-slider"></span>
                  </label>
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
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2rem;
    box-sizing: border-box;
  }

  .modal {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 12px;
    width: 95%;
    max-width: 1400px;
    height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
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
    margin: 0.25rem 0 0;
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

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 52px;
    height: 28px;
    flex-shrink: 0;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #475569;
    transition: 0.3s;
    border-radius: 28px;
  }

  .toggle-slider:before {
    position: absolute;
    content: '';
    height: 20px;
    width: 20px;
    left: 4px;
    bottom: 4px;
    background-color: white;
    transition: 0.3s;
    border-radius: 50%;
  }

  .toggle-switch input:checked + .toggle-slider {
    background-color: #10b981;
  }

  .toggle-switch input:checked + .toggle-slider:before {
    transform: translateX(24px);
  }

  .toggle-switch input:disabled + .toggle-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 768px) {
    .overlay {
      padding: 0;
      align-items: flex-end;
    }

    .modal {
      width: 100%;
      height: 100%;
      max-width: none;
      border-radius: 0;
      border: none;
      border-top: 1px solid #334155; /* Optional: adds a slight separation if partial height was used, but for fullscreen it might not be needed. Keeping border: none as per plan */
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
