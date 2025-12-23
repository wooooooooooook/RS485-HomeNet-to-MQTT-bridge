<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { onMount, untrack } from 'svelte';

  interface ContentSummary {
    entities: Record<string, number>;
    automations: number;
    scripts?: number;
  }

  interface GalleryItem {
    file: string;
    name: string;
    name_en?: string;
    description: string;
    description_en?: string;
    version: string;
    author: string;
    tags: string[];
    content_summary: ContentSummary;
    vendorId: string;
  }

  interface VendorRequirements {
    serial?: Record<string, unknown>;
    packet_defaults?: Record<string, unknown>;
  }

  interface CompatibilityResult {
    compatible: boolean;
    mismatches: { field: string; expected: unknown; actual: unknown }[];
  }

  interface Conflict {
    type: 'entity' | 'automation' | 'script';
    entityType?: string;
    id: string;
    existingYaml: string;
    newYaml: string;
  }

  interface NewItem {
    type: 'entity' | 'automation' | 'script';
    entityType?: string;
    id: string;
  }

  const GITHUB_RAW_BASE =
    'https://raw.githubusercontent.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/main/gallery';

  let {
    item,
    ports,
    vendorRequirements,
    onClose,
  }: {
    item: GalleryItem;
    ports: { portId: string; path: string }[];
    vendorRequirements?: VendorRequirements;
    onClose: () => void;
  } = $props();

  let yamlContent = $state('');
  let loadingYaml = $state(true);
  let yamlError = $state<string | null>(null);

  let selectedPortId = $state(untrack(() => ports[0]?.portId ?? ''));
  let applying = $state(false);
  let applyError = $state<string | null>(null);
  let applySuccess = $state(false);
  let showConfirmModal = $state(false);

  // Conflict detection states
  let checkingConflicts = $state(false);
  let conflicts = $state<Conflict[]>([]);
  let newItems = $state<NewItem[]>([]);
  let showConflictModal = $state(false);
  let resolutions = $state<Record<string, 'overwrite' | 'skip' | 'rename'>>({});
  let renames = $state<Record<string, string>>({});
  let expandedDiffs = $state<Set<string>>(new Set());

  // Compatibility check states
  let compatibility = $state<CompatibilityResult | null>(null);
  let forceApply = $state(false);

  const displayName = $derived(
    $locale?.startsWith('en') && item.name_en ? item.name_en : item.name,
  );

  const displayDescription = $derived(
    $locale?.startsWith('en') && item.description_en ? item.description_en : item.description,
  );

  const scriptCount = $derived(item.content_summary.scripts ?? 0);

  function formatItemLabel(itemType: 'entity' | 'automation' | 'script', entityType?: string) {
    if (itemType === 'entity') {
      return `[${entityType}]`;
    }
    if (itemType === 'automation') {
      return '[automation]';
    }
    return '[script]';
  }

  async function loadYamlContent() {
    loadingYaml = true;
    yamlError = null;
    try {
      const url = `${GITHUB_RAW_BASE}/${item.file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch YAML');
      yamlContent = await response.text();
    } catch (e) {
      yamlError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loadingYaml = false;
    }
  }

  onMount(() => {
    loadYamlContent();
  });

  function handleApplyClick() {
    showConfirmModal = true;
  }

  function cancelConfirm() {
    showConfirmModal = false;
  }

  async function confirmAndCheckConflicts() {
    showConfirmModal = false;
    checkingConflicts = true;
    applyError = null;

    try {
      const response = await fetch('/api/gallery/check-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId: selectedPortId,
          yamlContent,
          vendorRequirements,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to check conflicts');
      }

      const data = await response.json();
      conflicts = data.conflicts || [];
      newItems = data.newItems || [];
      compatibility = data.compatibility || null;

      // If incompatible and force not checked, show warning and don't proceed
      if (compatibility && !compatibility.compatible && !forceApply) {
        // Show conflict modal even without conflicts, to display compatibility warning
        if (conflicts.length > 0) {
          const defaultResolutions: Record<string, 'overwrite' | 'skip' | 'rename'> = {};
          for (const conflict of conflicts) {
            defaultResolutions[conflict.id] = 'overwrite';
          }
          resolutions = defaultResolutions;
          renames = {};
        }
        showConflictModal = true;
      } else if (conflicts.length > 0) {
        // Initialize resolutions to overwrite by default
        const defaultResolutions: Record<string, 'overwrite' | 'skip' | 'rename'> = {};
        for (const conflict of conflicts) {
          defaultResolutions[conflict.id] = 'overwrite';
        }
        resolutions = defaultResolutions;
        renames = {};
        showConflictModal = true;
      } else {
        // No conflicts and compatible, apply directly
        await applySnippet();
      }
    } catch (e) {
      applyError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      checkingConflicts = false;
    }
  }

  function cancelConflictModal() {
    showConflictModal = false;
  }

  function toggleDiff(id: string) {
    const newSet = new Set(expandedDiffs);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    expandedDiffs = newSet;
  }

  async function applyWithResolutions() {
    showConflictModal = false;
    await applySnippet();
  }

  async function applySnippet() {
    if (!selectedPortId) return;

    applying = true;
    applyError = null;
    applySuccess = false;

    try {
      const response = await fetch('/api/gallery/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId: selectedPortId,
          yamlContent,
          fileName: item.file,
          resolutions: Object.keys(resolutions).length > 0 ? resolutions : undefined,
          renames: Object.keys(renames).length > 0 ? renames : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to apply snippet');
      }

      applySuccess = true;
    } catch (e) {
      applyError = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      applying = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop">
  <button class="backdrop-close" onclick={onClose} aria-label={$t('common.close')}></button>
  <div class="modal" role="dialog" aria-modal="true">
    <header class="modal-header">
      <div class="header-content">
        <h2>{displayName}</h2>
        <p class="description">{displayDescription}</p>
      </div>
      <button class="close-btn" onclick={onClose} aria-label={$t('common.close')}> × </button>
    </header>

    <div class="modal-body">
      <div class="info-section">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">{$t('gallery.vendor')}</span>
            <span class="info-value">{item.vendorId}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{$t('gallery.version')}</span>
            <span class="info-value">v{item.version}</span>
          </div>
          <div class="info-item">
            <span class="info-label">{$t('gallery.author')}</span>
            <span class="info-value">{item.author}</span>
          </div>
        </div>

        <div class="contents-summary">
          <h4>{$t('gallery.preview.contents')}</h4>
          <div class="summary-badges">
            {#each Object.entries(item.content_summary.entities) as [type, count]}
              <span class="badge entity"
                >{$t('gallery.preview.entity_count', {
                  values: { type, count },
                })}</span
              >
            {/each}
            {#if item.content_summary.automations > 0}
              <span class="badge automation"
                >{$t('gallery.preview.automation_count', {
                  values: { count: item.content_summary.automations },
                })}</span
              >
            {/if}
            {#if scriptCount > 0}
              <span class="badge script"
                >{$t('gallery.preview.script_count', { values: { count: scriptCount } })}</span
              >
            {/if}
          </div>
        </div>

        {#if item.tags.length > 0}
          <div class="tags-section">
            <span class="info-label">{$t('gallery.tags')}</span>
            <div class="tags">
              {#each item.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="yaml-section">
        <h4>{$t('gallery.preview.yaml_content')}</h4>
        {#if loadingYaml}
          <div class="yaml-loading">
            <div class="spinner"></div>
          </div>
        {:else if yamlError}
          <div class="yaml-error">⚠️ {yamlError}</div>
        {:else}
          <pre class="yaml-content"><code>{yamlContent}</code></pre>
        {/if}
      </div>
    </div>

    <footer class="modal-footer">
      {#if applySuccess}
        <div class="success-message">✓ {$t('gallery.preview.success_with_backup')}</div>
      {:else if applyError}
        <div class="error-message">⚠️ {applyError}</div>
      {/if}

      <div class="footer-controls">
        <div class="port-select">
          <label for="port-select">{$t('gallery.preview.select_port')}</label>
          <select id="port-select" bind:value={selectedPortId}>
            {#each ports as port}
              <option value={port.portId}>{port.portId} ({port.path})</option>
            {/each}
          </select>
        </div>

        <div class="action-buttons">
          <button class="cancel-btn" onclick={onClose}>
            {$t('gallery.preview.cancel')}
          </button>
          <button
            class="apply-btn"
            onclick={handleApplyClick}
            disabled={applying || checkingConflicts || !selectedPortId || loadingYaml}
          >
            {#if applying}
              {$t('gallery.preview.applying')}
            {:else if checkingConflicts}
              {$t('gallery.preview.checking')}
            {:else}
              {$t('gallery.preview.apply')}
            {/if}
          </button>
        </div>
      </div>
    </footer>
  </div>
</div>

{#if showConfirmModal}
  <div class="confirm-backdrop">
    <div class="confirm-modal" role="alertdialog" aria-modal="true">
      <h3>{$t('gallery.preview.confirm_title')}</h3>
      <p class="warning-text">⚠️ {$t('gallery.preview.confirm_warning')}</p>
      <p class="proceed-text">{$t('gallery.preview.confirm_proceed')}</p>
      <div class="confirm-buttons">
        <button class="confirm-cancel-btn" onclick={cancelConfirm}>
          {$t('gallery.preview.confirm_cancel')}
        </button>
        <button class="confirm-apply-btn" onclick={confirmAndCheckConflicts}>
          {$t('gallery.preview.confirm_apply')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showConflictModal}
  <div class="confirm-backdrop">
    <div class="conflict-modal" role="dialog" aria-modal="true">
      {#if compatibility && !compatibility.compatible}
        <div class="compatibility-warning">
          <h4>⚠️ {$t('gallery.preview.compatibility.incompatible')}</h4>
          <p class="mismatch-label">{$t('gallery.preview.compatibility.mismatch_label')}:</p>
          <ul class="mismatch-list">
            {#each compatibility.mismatches as mismatch}
              <li>
                <code>{mismatch.field}</code>:
                <span class="expected"
                  >{$t('gallery.preview.compatibility.expected')}: {JSON.stringify(
                    mismatch.expected,
                  )}</span
                >
                <span class="actual"
                  >{$t('gallery.preview.compatibility.actual')}: {JSON.stringify(
                    mismatch.actual,
                  )}</span
                >
              </li>
            {/each}
          </ul>
          <label class="force-apply-checkbox">
            <input type="checkbox" bind:checked={forceApply} />
            {$t('gallery.preview.compatibility.force_apply')}
          </label>
          <p class="force-warning">{$t('gallery.preview.compatibility.force_apply_warning')}</p>
        </div>
      {:else if compatibility && compatibility.compatible}
        <div class="compatibility-ok">
          ✓ {$t('gallery.preview.compatibility.compatible')}
        </div>
      {/if}

      {#if conflicts.length > 0}
        <h3>{$t('gallery.preview.conflict_detected')}</h3>
        <p class="conflict-desc">
          {$t('gallery.preview.conflicts_found', { values: { count: conflicts.length } })}
        </p>

        <div class="conflict-list">
          {#each conflicts as conflict (conflict.id)}
            <div class="conflict-item">
              <div class="conflict-header">
                <span class="conflict-id">
                  {formatItemLabel(conflict.type, conflict.entityType)} {conflict.id}
                </span>
                <button class="toggle-diff-btn" onclick={() => toggleDiff(conflict.id)}>
                  {expandedDiffs.has(conflict.id) ? '▲' : '▼'}
                  {$t('gallery.preview.diff_title')}
                </button>
              </div>

              {#if expandedDiffs.has(conflict.id)}
                <div class="diff-container">
                  <div class="diff-pane">
                    <div class="diff-label">{$t('gallery.preview.existing')}</div>
                    <pre class="diff-content">{conflict.existingYaml}</pre>
                  </div>
                  <div class="diff-pane">
                    <div class="diff-label">{$t('gallery.preview.new')}</div>
                    <pre class="diff-content">{conflict.newYaml}</pre>
                  </div>
                </div>
              {/if}

              <div class="resolution-options">
                <label class="resolution-option">
                  <input
                    type="radio"
                    name={`resolution-${conflict.id}`}
                    value="overwrite"
                    checked={resolutions[conflict.id] === 'overwrite'}
                    onchange={() => (resolutions[conflict.id] = 'overwrite')}
                  />
                  {$t('gallery.preview.option_overwrite')}
                </label>
                <label class="resolution-option">
                  <input
                    type="radio"
                    name={`resolution-${conflict.id}`}
                    value="skip"
                    checked={resolutions[conflict.id] === 'skip'}
                    onchange={() => (resolutions[conflict.id] = 'skip')}
                  />
                  {$t('gallery.preview.option_skip')}
                </label>
                <label class="resolution-option">
                  <input
                    type="radio"
                    name={`resolution-${conflict.id}`}
                    value="rename"
                    checked={resolutions[conflict.id] === 'rename'}
                    onchange={() => (resolutions[conflict.id] = 'rename')}
                  />
                  {$t('gallery.preview.option_rename')}
                </label>
                {#if resolutions[conflict.id] === 'rename'}
                  <input
                    type="text"
                    class="rename-input"
                    placeholder={$t('gallery.preview.new_id_placeholder')}
                    value={renames[conflict.id] || ''}
                    oninput={(e) => (renames[conflict.id] = (e.target as HTMLInputElement).value)}
                  />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
      {#if newItems.length > 0}
        <div class="new-items-section">
          <h4>{$t('gallery.preview.new_items', { values: { count: newItems.length } })}</h4>
          <ul class="new-items-list">
            {#each newItems as newItem}
              <li>
                {formatItemLabel(newItem.type, newItem.entityType)} {newItem.id}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="confirm-buttons">
        <button class="confirm-cancel-btn" onclick={cancelConflictModal}>
          {$t('gallery.preview.cancel')}
        </button>
        <button
          class="confirm-apply-btn"
          onclick={applyWithResolutions}
          disabled={compatibility && !compatibility.compatible && !forceApply}
        >
          {$t('gallery.preview.apply')}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
    backdrop-filter: blur(4px);
  }

  .backdrop-close {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: none;
    border: none;
    cursor: default;
    z-index: 1;
  }

  .modal {
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    max-width: 800px;
    width: 100%;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    z-index: 2;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .header-content h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0 0 0.25rem 0;
  }

  .header-content .description {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: #f1f5f9;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .info-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .info-label {
    font-size: 0.75rem;
    color: #64748b;
    text-transform: uppercase;
  }

  .info-value {
    font-size: 0.9rem;
    color: #f1f5f9;
  }

  .contents-summary h4 {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0 0 0.5rem 0;
  }

  .summary-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .badge {
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-radius: 4px;
  }

  .badge.entity {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .badge.automation {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .badge.script {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .tags-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .tag {
    font-size: 0.7rem;
    color: #94a3b8;
    background: rgba(100, 116, 139, 0.2);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }

  .yaml-section {
    flex: 1;
    min-height: 0;
  }

  .yaml-section h4 {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0 0 0.75rem 0;
  }

  .yaml-loading {
    display: flex;
    justify-content: center;
    padding: 2rem;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(59, 130, 246, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .yaml-error {
    color: #f87171;
    padding: 1rem;
    text-align: center;
  }

  .yaml-content {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 8px;
    padding: 1rem;
    overflow: auto;
    max-height: 300px;
    margin: 0;
  }

  .yaml-content code {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.8rem;
    color: #e2e8f0;
    white-space: pre;
  }

  .modal-footer {
    padding: 1rem 1.5rem;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .success-message {
    color: #4ade80;
    font-size: 0.9rem;
    text-align: center;
  }

  .error-message {
    color: #f87171;
    font-size: 0.9rem;
    text-align: center;
  }

  .footer-controls {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .port-select {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .port-select label {
    font-size: 0.75rem;
    color: #64748b;
  }

  .port-select select {
    padding: 0.5rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    color: #f1f5f9;
    font-size: 0.85rem;
    min-width: 200px;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .cancel-btn,
  .apply-btn {
    padding: 0.6rem 1.25rem;
    border-radius: 6px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
  }

  .cancel-btn:hover {
    border-color: rgba(148, 163, 184, 0.4);
    color: #f1f5f9;
  }

  .apply-btn {
    background: #3b82f6;
    border: none;
    color: white;
  }

  .apply-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .apply-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .modal {
      max-height: 100vh;
      border-radius: 0;
    }

    .info-grid {
      grid-template-columns: 1fr 1fr;
    }

    .footer-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .port-select select {
      width: 100%;
    }

    .action-buttons {
      justify-content: flex-end;
    }
  }

  /* Confirm Modal Styles */
  .confirm-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
    backdrop-filter: blur(4px);
  }

  .confirm-modal {
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .confirm-modal h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0 0 1rem 0;
  }

  .confirm-modal .warning-text {
    font-size: 0.9rem;
    color: #fbbf24;
    margin: 0 0 0.75rem 0;
    line-height: 1.5;
  }

  .confirm-modal .proceed-text {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0 0 1.25rem 0;
  }

  .confirm-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .confirm-cancel-btn,
  .confirm-apply-btn {
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .confirm-cancel-btn {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
  }

  .confirm-cancel-btn:hover {
    border-color: rgba(148, 163, 184, 0.4);
    color: #f1f5f9;
  }

  .confirm-apply-btn {
    background: #3b82f6;
    border: none;
    color: white;
  }

  .confirm-apply-btn:hover {
    background: #2563eb;
  }

  /* Conflict Modal Styles */
  .conflict-modal {
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    padding: 1.5rem;
    max-width: 700px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .conflict-modal h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #f87171;
    margin: 0 0 0.5rem 0;
  }

  .conflict-desc {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0 0 1rem 0;
  }

  .conflict-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .conflict-item {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 8px;
    padding: 1rem;
  }

  .conflict-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .conflict-id {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.85rem;
    color: #f1f5f9;
  }

  .toggle-diff-btn {
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    cursor: pointer;
  }

  .toggle-diff-btn:hover {
    border-color: rgba(148, 163, 184, 0.4);
    color: #f1f5f9;
  }

  .diff-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .diff-pane {
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 6px;
    overflow: hidden;
  }

  .diff-label {
    font-size: 0.7rem;
    color: #64748b;
    text-transform: uppercase;
    padding: 0.25rem 0.5rem;
    background: rgba(148, 163, 184, 0.1);
  }

  .diff-content {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.7rem;
    color: #e2e8f0;
    padding: 0.5rem;
    margin: 0;
    overflow: auto;
    max-height: 150px;
    white-space: pre;
  }

  .resolution-options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .resolution-option {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8rem;
    color: #94a3b8;
    cursor: pointer;
  }

  .resolution-option input[type='radio'] {
    accent-color: #3b82f6;
  }

  .rename-input {
    padding: 0.35rem 0.5rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 4px;
    color: #f1f5f9;
    font-size: 0.8rem;
    min-width: 150px;
  }

  .new-items-section {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.2);
    border-radius: 8px;
    padding: 0.75rem;
    margin-bottom: 1rem;
  }

  .new-items-section h4 {
    font-size: 0.85rem;
    color: #4ade80;
    margin: 0 0 0.5rem 0;
  }

  .new-items-list {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0;
    padding-left: 1.25rem;
  }

  .new-items-list li {
    margin-bottom: 0.25rem;
  }

  @media (max-width: 640px) {
    .conflict-modal {
      max-height: 95vh;
    }

    .diff-container {
      grid-template-columns: 1fr;
    }

    .resolution-options {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  /* Compatibility styles */
  .compatibility-warning {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }

  .compatibility-warning h4 {
    font-size: 0.95rem;
    color: #f87171;
    margin: 0 0 0.75rem 0;
  }

  .compatibility-warning .mismatch-label {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0 0 0.5rem 0;
  }

  .compatibility-warning .mismatch-list {
    font-size: 0.8rem;
    color: #e2e8f0;
    margin: 0 0 0.75rem 0;
    padding-left: 1.25rem;
  }

  .compatibility-warning .mismatch-list li {
    margin-bottom: 0.4rem;
    line-height: 1.5;
  }

  .compatibility-warning .mismatch-list code {
    background: rgba(0, 0, 0, 0.3);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-family: 'Fira Code', monospace;
    color: #60a5fa;
  }

  .compatibility-warning .mismatch-list .expected {
    color: #f87171;
    margin-left: 0.5rem;
  }

  .compatibility-warning .mismatch-list .actual {
    color: #64748b;
    margin-left: 0.5rem;
  }

  .compatibility-warning .force-apply-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #e2e8f0;
    cursor: pointer;
    margin: 0.75rem 0 0.5rem 0;
  }

  .compatibility-warning .force-apply-checkbox input[type='checkbox'] {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .compatibility-warning .force-warning {
    font-size: 0.75rem;
    color: #f87171;
    opacity: 0.8;
    margin: 0;
  }

  .compatibility-ok {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    color: #4ade80;
  }
</style>
