<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import type { UnifiedEntity, CommandInfo, ParsedPacket, CommandPacket } from '../types';

  let {
    entity,
    parsedPackets = [],
    commandPackets = [],
    isOpen,
    isRenaming = false,
    renameError = null,
  } = $props<{
    entity: UnifiedEntity;
    parsedPackets?: ParsedPacket[];
    commandPackets?: CommandPacket[];
    isOpen: boolean;
    isRenaming?: boolean;
    renameError?: string | null;
  }>();

  const dispatch = createEventDispatcher<{
    close: void;
    execute: { cmd: CommandInfo; value?: any };
    rename: { newName: string };
  }>();

  let activeTab = $state<'status' | 'config' | 'packets' | 'manage'>('status');
  let editingConfig = $state('');
  let configLoading = $state(false);
  let configError = $state<string | null>(null);
  let isSaving = $state(false);
  let saveMessage = $state('');
  let renameInput = $state('');
  let renameLocalError = $state<string | null>(null);
  let renameEntityId = $state<string | null>(null);
  let effectiveRenameError = $state('');

  let commandInputs = $state<Record<string, any>>({});

  let showRx = $state(true);
  let showTx = $state(true);

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
    effectiveRenameError = renameLocalError || renameError || '';
  });

  function handleRename() {
    const trimmed = renameInput.trim();

    if (!trimmed) {
      renameLocalError = '새 이름을 입력해주세요.';
      return;
    }

    if (trimmed === entity.displayName) {
      renameLocalError = '변경된 내용이 없습니다.';
      return;
    }

    renameLocalError = null;
    dispatch('rename', { newName: trimmed });
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
          portId: entity.portId,
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

  async function handleRevokeDiscovery() {
    if (
      !confirm(
        '정말로 이 엔티티의 디스커버리 정보를 회수하시겠습니까?\n(상태 패킷이 수신되면 다시 등록됩니다)',
      )
    )
      return;

    try {
      const res = await fetch(`./api/entities/${entity.id}/revoke-discovery`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '실패했습니다.');
      }
      alert('디스커버리 정보가 회수되었습니다.');
    } catch (e) {
      alert(e instanceof Error ? e.message : '실패했습니다.');
    }
  }

  async function handleDeleteEntity() {
    if (
      !confirm(
        '정말로 이 엔티티를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며 설정 파일에서 영구적으로 제거됩니다.',
      )
    )
      return;

    try {
      const deleteUrl = entity.portId
        ? `./api/entities/${entity.id}?portId=${encodeURIComponent(entity.portId)}`
        : `./api/entities/${entity.id}`;
      const res = await fetch(deleteUrl, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '삭제 실패');
      }
      alert('삭제되었습니다. 변경 사항을 적용하려면 서비스 재시작이 필요할 수 있습니다.');
      close();
      window.location.reload(); // Reload to refresh entity list since it's a major change
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 실패');
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
        <button class="close-btn" onclick={close} aria-label="Close modal">&times;</button>
      </header>

      <div class="modal-tabs" role="tablist">
        <button
          role="tab"
          id="tab-status"
          aria-selected={activeTab === 'status'}
          aria-controls="panel-status"
          class:active={activeTab === 'status'}
          onclick={() => (activeTab = 'status')}>상태 & 명령</button
        >
        <button
          role="tab"
          id="tab-config"
          aria-selected={activeTab === 'config'}
          aria-controls="panel-config"
          class:active={activeTab === 'config'}
          onclick={() => (activeTab = 'config')}>설정 (YAML)</button
        >
        <button
          role="tab"
          id="tab-packets"
          aria-selected={activeTab === 'packets'}
          aria-controls="panel-packets"
          class:active={activeTab === 'packets'}
          onclick={() => (activeTab = 'packets')}>패킷 로그</button
        >
        <button
          role="tab"
          id="tab-manage"
          aria-selected={activeTab === 'manage'}
          aria-controls="panel-manage"
          class:active={activeTab === 'manage'}
          onclick={() => (activeTab = 'manage')}>관리</button
        >
      </div>

      <div class="modal-body">
        {#if activeTab === 'status'}
          <div role="tabpanel" id="panel-status" aria-labelledby="tab-status" tabindex="0">
            <div class="section status-section">
              <h3>현재 상태</h3>
              <div class="payload-list">
                {#each parsePayload(entity.statePayload) as item (item.key)}
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
                          <button
                            onclick={() =>
                              dispatch('execute', {
                                cmd,
                                value: commandInputs[`${cmd.entityId}_${cmd.commandName}`],
                              })}
                          >
                            전송
                          </button>
                        </div>
                      {:else}
                        <button class="action-btn" onclick={() => dispatch('execute', { cmd })}>
                          {cmd.displayName}
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {:else if activeTab === 'config'}
          <div role="tabpanel" id="panel-config" aria-labelledby="tab-config" tabindex="0">
            <div class="section config-section">
              {#if configLoading}
                <div class="loading">설정 불러오는 중...</div>
              {:else}
                <div class="config-editor-container">
                  <textarea class="config-editor" bind:value={editingConfig} spellcheck="false"
                  ></textarea>
                  <div class="config-actions">
                    <button class="save-btn" onclick={saveConfig} disabled={isSaving}>
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
          </div>
        {:else if activeTab === 'packets'}
          <div role="tabpanel" id="panel-packets" aria-labelledby="tab-packets" tabindex="0">
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
        {:else if activeTab === 'manage'}
          <div role="tabpanel" id="panel-manage" aria-labelledby="tab-manage" tabindex="0">
            <div class="section manage-card">
              <h3>이름 변경</h3>
              <p class="subtle">Home Assistant 엔티티 이름도 함께 변경됩니다.</p>
              <div class="rename-form">
                <input
                  type="text"
                  bind:value={renameInput}
                  placeholder="새 이름"
                  aria-label="새 엔티티 이름"
                  oninput={() => (renameLocalError = null)}
                />
                <button class="save-btn" onclick={handleRename} disabled={isRenaming}>
                  {isRenaming ? '변경 중...' : '저장'}
                </button>
              </div>
              {#if effectiveRenameError}
                <div class="rename-error">{effectiveRenameError}</div>
              {/if}
            </div>

            <div class="section manage-card">
              <h3>디스커버리 회수</h3>
              <p class="subtle">
                Home Assistant에서 엔티티의 디스커버리 정보를 제거합니다.<br />
                상태 패킷이 수신되면 자동으로 다시 등록됩니다.
              </p>
              <button class="action-btn-secondary" onclick={handleRevokeDiscovery}>
                디스커버리 회수
              </button>
            </div>

            <div class="section manage-card danger-zone">
              <h3>엔티티 삭제</h3>
              <p class="subtle">
                설정 파일에서 이 엔티티를 영구적으로 제거합니다.<br />
                <strong>이 작업은 되돌릴 수 없습니다.</strong>
              </p>
              <button class="danger-btn" onclick={handleDeleteEntity}> 엔티티 삭제 </button>
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

  .danger-btn {
    background: #ef4444;
    border: none;
    color: white;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .danger-btn:hover {
    background: #dc2626;
  }

  .danger-btn.outline {
    background: transparent;
    border: 1px solid #ef4444;
    color: #ef4444;
  }

  .danger-btn.outline:hover {
    background: rgba(239, 68, 68, 0.1);
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

  .action-btn-secondary {
    background: #334155;
    border: 1px solid #475569;
    color: #fff;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .action-btn-secondary:hover {
    background: #475569;
    border-color: #64748b;
  }

  .danger-zone {
    border-color: rgba(239, 68, 68, 0.3);
    background: rgba(239, 68, 68, 0.05);
  }

  .danger-zone h3 {
    color: #f87171;
  }
</style>
