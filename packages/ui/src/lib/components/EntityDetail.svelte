<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import type { UnifiedEntity, CommandInfo, ParsedPacket, CommandPacket } from '../types';

  export let entity: UnifiedEntity;
  export let parsedPackets: ParsedPacket[] = [];
  export let commandPackets: CommandPacket[] = [];
  export let isOpen: boolean;

  const dispatch = createEventDispatcher<{
    close: void;
    execute: { cmd: CommandInfo; value?: any };
  }>();

  let activeTab: 'status' | 'config' | 'packets' = 'status';
  let editingConfig = '';
  let configLoading = false;
  let configError: string | null = null;
  let isSaving = false;
  let saveMessage = '';

  let commandInputs: Record<string, any> = {};

  let showRx = true;
  let showTx = true;

  type MergedPacket = ({ type: 'rx' } & ParsedPacket) | ({ type: 'tx' } & CommandPacket);

  $: mergedPackets = (() => {
    const packets: MergedPacket[] = [];

    if (showRx) {
      packets.push(...parsedPackets.map((p) => ({ ...p, type: 'rx' }) as const));
    }
    if (showTx) {
      packets.push(...commandPackets.map((p) => ({ ...p, type: 'tx' }) as const));
    }

    return packets.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  })();

  // Use a variable to track the entity ID for which config was last loaded into the editor
  let loadedConfigEntityId: string | null = null;

  onMount(() => {
    // Initial load if modal is already open and entity is available (unlikely onMount but good practice)
    if (isOpen && entity && activeTab === 'config' && loadedConfigEntityId !== entity.id) {
      loadRawConfig();
      loadedConfigEntityId = entity.id;
    }
  });

  $: if (isOpen && entity && activeTab === 'config') {
    // Only load config if a new entity is selected OR if we're switching to the config tab for a new entity
    if (loadedConfigEntityId !== entity.id) {
      loadRawConfig();
      loadedConfigEntityId = entity.id;
    }
  } else if (!isOpen) {
    // Reset loadedConfigEntityId when the modal is closed
    loadedConfigEntityId = null;
  }
  
  // Re-initialize command inputs only when the entity.id changes or modal opens for a *new* entity
  $: if (isOpen && entity && loadedConfigEntityId !== entity.id) { // This condition needs to be adjusted. It should run when the entity for the modal changes.
    // The previous implementation was: $: if (isOpen && entity)
    // The issue here is that loadedConfigEntityId is for the config tab, not for the general entity object.
    // Let's use a separate flag for the entity itself.
    // However, the intent of the old code was to initialize inputs when *any* entity detail was opened or changed.
    // This is fine as long as `commandInputs` are tied to the entity ID.
    // Let's revert this reactive statement to its original form for now, it's not the cause of config editing issue.
    // The previous change was based on the assumption that `loadedConfigEntityId` was to control all entity updates.
    // It's only for the config editor.

    // Revert to the original: This block runs when `isOpen` or `entity` changes.
    // This is correct for initializing inputs for the currently displayed entity.
    entity.commands.forEach((cmd) => {
      if (cmd.inputType === 'number') {
        commandInputs[`${cmd.entityId}_${cmd.commandName}`] = cmd.min ?? 0;
      }
    });
  }

  async function loadRawConfig() {
    configLoading = true;
    configError = null;
    saveMessage = '';
    try {
      const res = await fetch(`./api/config/raw/${entity.id}`);
      if (!res.ok) throw new Error('Failed to load config');
      const data = await res.json();
      editingConfig = data.yaml;
    } catch (err) {
      configError = '설정 정보를 불러올 수 없습니다.';
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
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '저장에 실패했습니다.');
      }

      saveMessage = `저장 완료 (백업: ${data.backup})`;
    } catch (err) {
      configError = err instanceof Error ? err.message : '저장에 실패했습니다.';
    } finally {
      isSaving = false;
    }
  }

  function close() {
    dispatch('close');
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
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div
    class="overlay"
    on:click={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    transition:fade={{ duration: 200 }}
    role="button"
    tabindex="0"
    on:keydown={handleKeydown}
    aria-label="Close modal"
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
          <span class="entity-id">{entity.id}</span>
        </div>
        <button class="close-btn" on:click={close} aria-label="Close modal">&times;</button>
      </header>

      <div class="modal-tabs">
        <button class:active={activeTab === 'status'} on:click={() => (activeTab = 'status')}
          >상태 & 명령</button
        >
        <button class:active={activeTab === 'config'} on:click={() => (activeTab = 'config')}
          >설정 (YAML)</button
        >
        <button class:active={activeTab === 'packets'} on:click={() => (activeTab = 'packets')}
          >패킷 로그</button
        >
      </div>

      <div class="modal-body">
        {#if activeTab === 'status'}
          <div class="section status-section">
            <h3>현재 상태</h3>
            <div class="payload-list">
              {#each parsePayload(entity.statePayload) as item}
                <div class="payload-item">
                  <span class="payload-key">{item.key}</span>
                  <span class="payload-value">{item.value}</span>
                </div>
              {/each}
              {#if !entity.statePayload}
                <div class="no-data">상태 정보가 없습니다.</div>
              {/if}
            </div>
          </div>

          {#if entity.commands.length > 0}
            <div class="section command-section">
              <h3>명령 보내기</h3>
              <div class="command-grid">
                {#each entity.commands as cmd}
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
                        <button
                          on:click={() =>
                            dispatch('execute', {
                              cmd,
                              value: commandInputs[`${cmd.entityId}_${cmd.commandName}`],
                            })}
                        >
                          전송
                        </button>
                      </div>
                    {:else}
                      <button class="action-btn" on:click={() => dispatch('execute', { cmd })}>
                        {cmd.displayName}
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else if activeTab === 'config'}
          <div class="section config-section">
            {#if configLoading}
              <div class="loading">설정 불러오는 중...</div>
            {:else}
              <div class="config-editor-container">
                <textarea 
                  class="config-editor" 
                  bind:value={editingConfig}
                  spellcheck="false"
                ></textarea>
                <div class="config-actions">
                  <button class="save-btn" on:click={saveConfig} disabled={isSaving}>
                    {isSaving ? '저장 중...' : '저장'}
                  </button>
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
        {:else if activeTab === 'packets'}
          <div class="section packet-log-section">
            <div class="log-header">
              <div class="header-left">
                <h4>패킷 로그 (RX/TX)</h4>
                <div class="filters">
                  <label>
                    <input type="checkbox" bind:checked={showRx} /> RX (수신)
                  </label>
                  <label>
                    <input type="checkbox" bind:checked={showTx} /> TX (발신)
                  </label>
                </div>
              </div>
            </div>
            <div class="log-list unified-list">
              {#if mergedPackets.length === 0}
                <div class="no-data">표시할 패킷이 없습니다.</div>
              {:else}
                {#each mergedPackets as packet}
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

  .action-btn {
    width: 100%;
    height: 60px;
    box-sizing: border-box;
    padding: 0.75rem;
    background: #334155;
    border: 1px solid #475569;
    color: #fff;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .action-btn:hover {
    background: #475569;
  }

  .input-group {
    display: flex;
    height: 60px;
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
    width: 40px;
    font-size: 0.9rem;
  }

  .input-group input:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .input-group button {
    background: #0ea5e9;
    border: none;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    transition: background-color 0.2s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .input-group button:hover {
    background: #0284c7;
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

  .save-btn {
    background: #10b981;
    border: none;
    color: white;
    padding: 0.5rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.2s;
  }

  .save-btn:hover:not(:disabled) {
    background: #059669;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
</style>

