<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import Button from './Button.svelte';
  import Modal from './Modal.svelte';
  import Dialog from './Dialog.svelte';
  import { triggerSystemRestart as restartApp } from '../utils/appControl';
  import type {
    GalleryDiscoveryResult,
    GalleryItemForPreview,
    GalleryMatch,
    GalleryMatchCandidate,
    GalleryParameterDefinition,
    GallerySchemaField,
    GalleryVendorRequirements,
  } from '../types';

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

  type MatchAction = 'overwrite' | 'add' | 'skip';

  const GALLERY_FILE_API = './api/gallery/file';

  let {
    item,
    portId,
    vendorRequirements,
    discoveryResult,
    onClose,
  }: {
    item: GalleryItemForPreview;
    portId: string | null;
    vendorRequirements?: GalleryVendorRequirements;
    discoveryResult?: GalleryDiscoveryResult;
    onClose: () => void;
  } = $props();

  const isDiscovered = $derived(discoveryResult?.matched ?? false);

  let yamlContent = $state('');
  let loadingYaml = $state(true);
  let yamlError = $state<string | null>(null);

  let applying = $state(false);
  let applyError = $state<string | null>(null);
  let applySuccess = $state(false);
  let restarting = $state(false);
  let parameterError = $state<string | null>(null);
  let parameterInputs = $state<Record<string, string>>({});

  // Conflict detection states
  let checkingConflicts = $state(false);
  let conflicts = $state<Conflict[]>([]);
  let matches = $state<GalleryMatch[]>([]);
  let newItems = $state<NewItem[]>([]);
  let showConflictModal = $state(false);
  let resolutions = $state<Record<string, 'overwrite' | 'skip' | 'rename'>>({});
  let renames = $state<Record<string, string>>({});
  let matchActions = $state<Record<string, MatchAction>>({});
  let matchTargets = $state<Record<string, string>>({}); // galleryId -> selected matchedId
  let expandedDiffs = $state<Set<string>>(new Set());

  // Detect duplicate match target selections
  const duplicateTargets = $derived.by(() => {
    const targetCounts = new Map<string, string[]>();
    for (const [galleryId, action] of Object.entries(matchActions)) {
      if (action !== 'overwrite') continue;
      const targetId = matchTargets[galleryId];
      if (!targetId) continue;
      if (!targetCounts.has(targetId)) {
        targetCounts.set(targetId, []);
      }
      targetCounts.get(targetId)!.push(galleryId);
    }
    // Return map of targetId -> array of galleryIds that selected it (only duplicates)
    const duplicates = new Map<string, string[]>();
    for (const [targetId, galleryIds] of targetCounts) {
      if (galleryIds.length > 1) {
        duplicates.set(targetId, galleryIds);
      }
    }
    return duplicates;
  });

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
  const hasParameters = $derived((item.parameters?.length ?? 0) > 0);

  function formatItemLabel(itemType: 'entity' | 'automation' | 'script', entityType?: string) {
    if (itemType === 'entity') {
      return `[${entityType}]`;
    }
    if (itemType === 'automation') {
      return '[automation]';
    }
    return '[script]';
  }

  function resolveErrorMessage(error: any) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';
    const errorCode = (error as any)?.error;

    if (errorCode === 'Incompatible version' || message === 'Incompatible version') {
      const minVersion = (error as any).minVersion || '?';
      const appVersion = (error as any).appVersion || '?';
      return $t('gallery.incompatible_version', {
        values: { minVersion, appVersion },
      });
    }
    return message;
  }

  async function loadYamlContent() {
    loadingYaml = true;
    yamlError = null;
    try {
      const url = `${GALLERY_FILE_API}?path=${encodeURIComponent(item.file)}`;
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
    initializeParameterInputs();
  });

  function initializeParameterInputs() {
    const inputs: Record<string, string> = {};
    if (!item.parameters) {
      parameterInputs = inputs;
      return;
    }

    for (const parameter of item.parameters) {
      // Check if discovery result has a value for this parameter
      const discoveredValue = discoveryResult?.parameterValues?.[parameter.name];
      if (discoveredValue !== undefined && typeof discoveredValue === 'number') {
        inputs[parameter.name] = String(discoveredValue);
        continue;
      }

      // Fall back to default value
      if (parameter.default !== undefined) {
        if (typeof parameter.default === 'string') {
          inputs[parameter.name] = parameter.default;
        } else {
          inputs[parameter.name] = JSON.stringify(parameter.default);
        }
      } else {
        inputs[parameter.name] = '';
      }
    }

    parameterInputs = inputs;
  }

  function resolveParameterLabel(parameter: GalleryParameterDefinition) {
    if ($locale?.startsWith('en')) {
      return parameter.label_en || parameter.label || parameter.name;
    }
    return parameter.label || parameter.name;
  }

  function resolveParameterDescription(parameter: GalleryParameterDefinition) {
    if ($locale?.startsWith('en')) {
      return parameter.description_en || parameter.description || '';
    }
    return parameter.description || '';
  }

  function resolveSchemaFieldLabel(field: GallerySchemaField, fieldName: string): string {
    if ($locale?.startsWith('en')) {
      return field.label_en || field.label || fieldName;
    }
    return field.label || fieldName;
  }

  function formatSchemaFieldType(field: GallerySchemaField): string {
    const typeName =
      field.type === 'integer'
        ? $t('gallery.preview.parameters.type_integer')
        : field.type === 'string'
          ? $t('gallery.preview.parameters.type_string')
          : field.type === 'boolean'
            ? $t('gallery.preview.parameters.type_boolean')
            : field.type;
    return typeName;
  }

  function formatSchemaFieldConstraints(field: GallerySchemaField): string {
    const constraints: string[] = [];
    if (field.min !== undefined) {
      constraints.push(`${$t('gallery.preview.parameters.min')}: ${field.min}`);
    }
    if (field.max !== undefined) {
      constraints.push(`${$t('gallery.preview.parameters.max')}: ${field.max}`);
    }
    return constraints.join(', ');
  }

  function updateParameterInput(name: string, value: string) {
    parameterInputs = { ...parameterInputs, [name]: value };
  }

  function buildParameterValues() {
    parameterError = null;

    if (!item.parameters || item.parameters.length === 0) {
      return undefined;
    }

    const values: Record<string, unknown> = {};

    for (const parameter of item.parameters) {
      const rawValue = parameterInputs[parameter.name]?.trim() ?? '';

      if (parameter.type === 'integer') {
        if (rawValue === '') {
          throw new Error($t('gallery.preview.parameters.validation_required'));
        }
        const parsed = Number.parseInt(rawValue, 10);
        if (!Number.isInteger(parsed)) {
          throw new Error($t('gallery.preview.parameters.validation_integer'));
        }
        values[parameter.name] = parsed;
        continue;
      }

      if (parameter.type === 'string') {
        if (rawValue === '') {
          throw new Error($t('gallery.preview.parameters.validation_required'));
        }
        values[parameter.name] = rawValue;
        continue;
      }

      if (rawValue === '') {
        throw new Error($t('gallery.preview.parameters.validation_required'));
      }

      try {
        const parsed = JSON.parse(rawValue);
        if (parameter.type === 'integer[]' && !Array.isArray(parsed)) {
          throw new Error($t('gallery.preview.parameters.validation_array'));
        }
        if (parameter.type === 'object[]') {
          if (!Array.isArray(parsed)) {
            throw new Error($t('gallery.preview.parameters.validation_array'));
          }
          const invalidItem = parsed.find((item) => !item || typeof item !== 'object');
          if (invalidItem) {
            throw new Error($t('gallery.preview.parameters.validation_object_array'));
          }
        }
        values[parameter.name] = parsed;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : $t('gallery.preview.parameters.validation_json');
        throw new Error(message);
      }
    }

    return values;
  }

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
    onSuccess?: () => void;
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
        console.error(err);
      } finally {
        if (!onSuccess) dialog.loading = false;
      }
    };
    dialog.open = true;
  };

  async function triggerSystemRestart() {
    restarting = true;
    dialog.title = $t('settings.app_control.restart');
    dialog.message = $t('settings.app_control.restarting');
    dialog.loadingText = $t('settings.app_control.restarting');
    dialog.variant = 'primary';
    dialog.showCancel = false;
    dialog.loading = true;
    dialog.open = true;
    await restartApp();
  }

  async function handleRestart() {
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

  async function confirmAndCheckConflicts() {
    checkingConflicts = true;
    applyError = null;
    parameterError = null;

    try {
      const parameterValues = buildParameterValues();
      const response = await fetch('./api/gallery/check-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId,
          yamlContent,
          vendorRequirements,
          parameterValues,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        // Throw object to preserve extra fields (minVersion, appVersion)
        const error = new Error(data.error || 'Failed to check conflicts');
        Object.assign(error, data);
        throw error;
      }

      const data = await response.json();
      conflicts = data.conflicts || [];
      matches = data.matches || [];
      newItems = data.newItems || [];
      compatibility = data.compatibility || null;
      resolutions = {};
      renames = {};

      // Initialize matchActions and matchTargets with duplicate-avoidance logic
      function initializeMatchTargets() {
        const usedTargets = new Set<string>();
        const actions: Record<string, MatchAction> = {};
        const targets: Record<string, string> = {};

        for (const match of matches) {
          // Find first available target (not already used) with >= 80% similarity
          let selectedTarget = '';
          let bestSimilarity = 0;

          if (match.candidates && match.candidates.length > 0) {
            for (const candidate of match.candidates) {
              if (!usedTargets.has(candidate.matchId) && candidate.similarity >= 0.8) {
                selectedTarget = candidate.matchId;
                bestSimilarity = candidate.similarity;
                break;
              }
            }
            // If no high-similarity candidate available, just pick the best one
            if (!selectedTarget) {
              selectedTarget = match.candidates[0].matchId;
              bestSimilarity = match.candidates[0].similarity;
            }
          } else {
            selectedTarget = match.matchedId;
            bestSimilarity = match.similarity || 0;
          }

          // Default action: 'overwrite' if >= 80% similarity, otherwise 'add'
          actions[match.id] = bestSimilarity >= 0.8 ? 'overwrite' : 'add';
          targets[match.id] = selectedTarget;
          if (actions[match.id] === 'overwrite') {
            usedTargets.add(selectedTarget);
          }
        }

        return { actions, targets };
      }

      const { actions: defaultActions, targets: defaultTargets } = initializeMatchTargets();
      matchActions = defaultActions;
      matchTargets = defaultTargets;

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
      } else if (matches.length > 0 || (compatibility && !compatibility.compatible)) {
        showConflictModal = true;
      } else {
        // No conflicts and compatible, apply directly
        await applySnippet();
      }
    } catch (e: any) {
      const resolvedMessage = resolveErrorMessage(e);
      parameterError = resolvedMessage;
      applyError = resolvedMessage;
    } finally {
      checkingConflicts = false;
    }
  }

  function cancelConflictModal() {
    showConflictModal = false;
  }

  function toggleDiff(key: string) {
    const newSet = new Set(expandedDiffs);
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    expandedDiffs = newSet;
  }

  async function applyWithResolutions() {
    showConflictModal = false;
    await applySnippet();
  }

  async function applySnippet() {
    if (!portId) return;

    applying = true;
    applyError = null;
    applySuccess = false;
    parameterError = null;

    try {
      const parameterValues = buildParameterValues();
      const { payloadResolutions, payloadRenames } = buildResolutionPayload();
      const response = await fetch('./api/gallery/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portId,
          yamlContent,
          fileName: item.file,
          resolutions: Object.keys(payloadResolutions).length > 0 ? payloadResolutions : undefined,
          renames: Object.keys(payloadRenames).length > 0 ? payloadRenames : undefined,
          parameterValues,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        // Throw object to preserve extra fields (minVersion, appVersion)
        const error = new Error(data.error || 'Failed to apply snippet');
        Object.assign(error, data);
        throw error;
      }

      applySuccess = true;
    } catch (e: any) {
      const resolvedMessage = resolveErrorMessage(e);
      parameterError = resolvedMessage;
      applyError = resolvedMessage;
    } finally {
      applying = false;
    }
  }

  function buildResolutionPayload() {
    const payloadResolutions: Record<string, 'overwrite' | 'skip' | 'rename'> = {
      ...resolutions,
    };
    const payloadRenames: Record<string, string> = { ...renames };

    for (const match of matches) {
      const action = matchActions[match.id] || 'overwrite';

      if (action === 'overwrite') {
        payloadResolutions[match.id] = 'overwrite';
        // Use selected target from dropdown instead of default matchedId
        payloadRenames[match.id] = matchTargets[match.id] || match.matchedId;
      } else if (action === 'skip') {
        payloadResolutions[match.id] = 'skip';
        delete payloadRenames[match.id];
      } else {
        delete payloadResolutions[match.id];
        delete payloadRenames[match.id];
      }
    }

    return { payloadResolutions, payloadRenames };
  }
</script>

<Modal
  open={true}
  width="800px"
  onclose={onClose}
  oncancel={onClose}
  ariaLabelledBy="gallery-preview-title"
  ariaDescribedBy="gallery-preview-desc"
>
  <div class="modal-content-wrapper">
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
    <header class="modal-header">
      <div class="header-content">
        <h2 id="gallery-preview-title">{displayName}</h2>
        <p id="gallery-preview-desc" class="description">{displayDescription}</p>
      </div>
      <button class="close-btn" onclick={onClose} aria-label={$t('common.close')}> × </button>
    </header>

    {#if applySuccess}
      <div class="modal-body success-view">
        <div class="success-icon">✓</div>
        <p class="success-message">{$t('gallery.preview.success_with_backup')}</p>
      </div>
      <footer class="modal-footer success-footer">
        <div class="success-buttons">
          <Button
            variant="danger"
            onclick={handleRestart}
            disabled={restarting}
            isLoading={restarting}
            fullWidth
          >
            {$t('gallery.preview.restart_now')}
          </Button>
          <Button variant="secondary" onclick={onClose} fullWidth>
            {$t('common.close')}
          </Button>
        </div>
      </footer>
    {:else}
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
            {#if portId}
              <div class="info-item">
                <span class="info-label">{$t('gallery.preview.target_port')}</span>
                <span class="info-value">{portId}</span>
              </div>
            {/if}
          </div>

          <div class="contents-summary">
            <h4>{$t('gallery.preview.contents')}</h4>
            <div class="summary-badges">
              {#each Object.entries(item.content_summary.entities) as [type, count], index (`${type}-${index}`)}
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
                {#each item.tags as tag, index (`${tag}-${index}`)}
                  <span class="tag">{tag}</span>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        {#if hasParameters}
          <div class="parameter-section">
            <h4 class="parameter-section-title">{$t('gallery.preview.parameters.title')}</h4>
            <div class="parameter-list">
              {#each item.parameters as parameter (parameter.name)}
                <div class="parameter-item">
                  <label class="parameter-label" for={`parameter-${parameter.name}`}>
                    {resolveParameterLabel(parameter)}
                  </label>
                  {#if resolveParameterDescription(parameter)}
                    <p class="parameter-description">{resolveParameterDescription(parameter)}</p>
                  {/if}

                  {#if parameter.type === 'integer'}
                    <input
                      id={`parameter-${parameter.name}`}
                      type="number"
                      min={parameter.min}
                      max={parameter.max}
                      value={parameterInputs[parameter.name]}
                      placeholder={$t('gallery.preview.parameters.placeholder_integer')}
                      oninput={(event) =>
                        updateParameterInput(
                          parameter.name,
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                  {:else if parameter.type === 'string'}
                    <input
                      id={`parameter-${parameter.name}`}
                      type="text"
                      value={parameterInputs[parameter.name]}
                      placeholder={$t('gallery.preview.parameters.placeholder_string')}
                      oninput={(event) =>
                        updateParameterInput(
                          parameter.name,
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                  {:else}
                    {#if parameter.schema && Object.keys(parameter.schema).length > 0}
                      <div class="schema-chips">
                        {#each Object.entries(parameter.schema) as [fieldName, field] (fieldName)}
                          <div class="schema-chip">
                            <span class="schema-chip-name">{fieldName}</span>
                            <span class="schema-chip-label"
                              >{resolveSchemaFieldLabel(field, fieldName)}</span
                            >
                            <span class="schema-chip-type">{formatSchemaFieldType(field)}</span>
                            {#if formatSchemaFieldConstraints(field)}
                              <span class="schema-chip-constraints"
                                >{formatSchemaFieldConstraints(field)}</span
                              >
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                    <textarea
                      id={`parameter-${parameter.name}`}
                      rows="4"
                      value={parameterInputs[parameter.name]}
                      placeholder={$t('gallery.preview.parameters.placeholder_json')}
                      oninput={(event) =>
                        updateParameterInput(
                          parameter.name,
                          (event.target as HTMLTextAreaElement).value,
                        )}
                    ></textarea>
                  {/if}
                </div>
              {/each}
            </div>

            {#if parameterError}
              <div class="parameter-error">⚠️ {parameterError}</div>
            {/if}
          </div>
        {/if}

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
        {#if applyError}
          <div class="error-message">⚠️ {applyError}</div>
        {/if}

        <div class="footer-controls">
          <div class="action-buttons">
            <Button variant="secondary" onclick={onClose}>
              {$t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onclick={confirmAndCheckConflicts}
              isLoading={applying || checkingConflicts}
              disabled={!portId || loadingYaml}
            >
              {#if applying}
                {$t('gallery.preview.applying')}
              {:else if checkingConflicts}
                {$t('gallery.preview.checking')}
              {:else}
                {$t('gallery.preview.apply')}
              {/if}
            </Button>
          </div>
        </div>
      </footer>
    {/if}
  </div>
</Modal>

<Modal
  open={showConflictModal}
  width="700px"
  onclose={cancelConflictModal}
  oncancel={cancelConflictModal}
>
  <div class="conflict-modal-wrapper">
    {#if compatibility && !compatibility.compatible}
      <div class="compatibility-warning">
        <h4>⚠️ {$t('gallery.preview.compatibility.incompatible')}</h4>
        <p class="mismatch-label">{$t('gallery.preview.compatibility.mismatch_label')}:</p>
        <ul class="mismatch-list">
          {#each compatibility.mismatches as mismatch, index (`${mismatch.field}-${index}`)}
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

    {#if matches.length > 0}
      <h3>{$t('gallery.preview.match_detected')}</h3>
      <p class="conflict-desc">
        {$t('gallery.preview.matches_found', { values: { count: matches.length } })}
      </p>

      {#if duplicateTargets.size > 0}
        <div class="duplicate-warning">
          ⚠️ {$t('gallery.preview.duplicate_target_warning')}
        </div>
      {/if}

      <div class="conflict-list">
        {#each matches as match, index (`${match.id}-${index}`)}
          {@const selectedTarget = matchTargets[match.id] || match.matchedId}
          {@const selectedCandidate = match.candidates?.find((c) => c.matchId === selectedTarget)}
          {@const selectedExistingYaml = selectedCandidate?.existingYaml || match.existingYaml}
          {@const selectedSimilarity = selectedCandidate?.similarity ?? match.similarity}
          {@const isDuplicate =
            duplicateTargets.has(selectedTarget) && matchActions[match.id] === 'overwrite'}
          <div class="conflict-item" class:duplicate={isDuplicate}>
            <div class="conflict-header">
              <span class="conflict-id">
                ID: <strong>{match.id}</strong>
              </span>
              {#if match.candidates && match.candidates.length > 1}
                <select
                  class="match-target-select"
                  value={selectedTarget}
                  onchange={(e) => {
                    matchTargets[match.id] = (e.target as HTMLSelectElement).value;
                  }}
                  disabled={matchActions[match.id] !== 'overwrite'}
                >
                  {#each match.candidates as candidate}
                    <option value={candidate.matchId}>
                      {candidate.matchId} ({Math.round(candidate.similarity * 100)}%)
                    </option>
                  {/each}
                </select>
              {:else}
                <span class="match-id">
                  {$t('gallery.preview.match_target', { values: { id: selectedTarget } })}
                  {#if selectedSimilarity !== undefined}
                    <span class="similarity-badge">
                      {Math.round(selectedSimilarity * 100)}%
                    </span>
                  {/if}
                </span>
              {/if}
              {#if isDuplicate}
                <span class="duplicate-badge">⚠️</span>
              {/if}
              <button class="toggle-diff-btn" onclick={() => toggleDiff(`match-${match.id}`)}>
                {expandedDiffs.has(`match-${match.id}`) ? '▲' : '▼'}
                {$t('gallery.preview.diff_title')}
              </button>
            </div>

            {#if expandedDiffs.has(`match-${match.id}`)}
              <div class="diff-container">
                <div class="diff-pane">
                  <div class="diff-label">{$t('gallery.preview.existing')} ({selectedTarget})</div>
                  <pre class="diff-content">{selectedExistingYaml}</pre>
                </div>
                <div class="diff-pane">
                  <div class="diff-label">{$t('gallery.preview.new')}</div>
                  <pre class="diff-content">{match.newYaml}</pre>
                </div>
              </div>
            {/if}

            <div class="resolution-options">
              <label class="resolution-option">
                <input
                  type="radio"
                  name="match-resolution-{match.id}"
                  value="overwrite"
                  checked={matchActions[match.id] === 'overwrite'}
                  onchange={() => (matchActions[match.id] = 'overwrite')}
                />
                {$t('gallery.preview.option_match_overwrite')}
              </label>
              <label class="resolution-option">
                <input
                  type="radio"
                  name="match-resolution-{match.id}"
                  value="add"
                  checked={matchActions[match.id] === 'add'}
                  onchange={() => (matchActions[match.id] = 'add')}
                />
                {$t('gallery.preview.option_match_add')}
              </label>
              <label class="resolution-option">
                <input
                  type="radio"
                  name="match-resolution-{match.id}"
                  value="skip"
                  checked={matchActions[match.id] === 'skip'}
                  onchange={() => (matchActions[match.id] = 'skip')}
                />
                {$t('gallery.preview.option_match_skip')}
              </label>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if conflicts.length > 0}
      <h3>{$t('gallery.preview.conflict_detected')}</h3>
      <p class="conflict-desc">
        {$t('gallery.preview.conflicts_found', { values: { count: conflicts.length } })}
      </p>

      <div class="conflict-list">
        {#each conflicts as conflict, index (`${conflict.id}-${index}`)}
          <div class="conflict-item">
            <div class="conflict-header">
              <span class="conflict-id">
                ID: <strong>{conflict.id}</strong>
              </span>
              <button class="toggle-diff-btn" onclick={() => toggleDiff(`conflict-${conflict.id}`)}>
                {expandedDiffs.has(`conflict-${conflict.id}`) ? '▲' : '▼'}
                {$t('gallery.preview.diff_title')}
              </button>
            </div>

            {#if expandedDiffs.has(`conflict-${conflict.id}`)}
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
                  name="resolution-{conflict.id}"
                  value="overwrite"
                  checked={resolutions[conflict.id] === 'overwrite'}
                  onchange={() => (resolutions[conflict.id] = 'overwrite')}
                />
                {$t('gallery.preview.option_overwrite')}
              </label>
              <label class="resolution-option">
                <input
                  type="radio"
                  name="resolution-{conflict.id}"
                  value="skip"
                  checked={resolutions[conflict.id] === 'skip'}
                  onchange={() => (resolutions[conflict.id] = 'skip')}
                />
                {$t('gallery.preview.option_skip')}
              </label>
              <label class="resolution-option">
                <input
                  type="radio"
                  name="resolution-{conflict.id}"
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
          {#each newItems as newItem, index (`${newItem.id}-${index}`)}
            <li>
              • {newItem.id} ({newItem.type})
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="confirm-buttons">
      <Button variant="secondary" onclick={cancelConflictModal}>
        {$t('gallery.preview.cancel')}
      </Button>
      <Button
        variant="primary"
        onclick={applyWithResolutions}
        disabled={!!(compatibility && !compatibility.compatible && !forceApply)}
      >
        {$t('gallery.preview.apply')}
      </Button>
    </div>
  </div>
</Modal>

<style>
  .modal-content-wrapper {
    background: #1e293b;
    width: 100%;
    /* Fit inside Modal 90dvh */
    height: 85dvh;
    display: flex;
    flex-direction: column;
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

  .parameter-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.6);
  }

  .parameter-section-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f1f5f9;
    margin: 0 0 0.5rem 0;
  }

  .parameter-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .parameter-item {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .parameter-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #f1f5f9;
  }

  .parameter-description {
    margin: 0;
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .parameter-item input,
  .parameter-item textarea {
    padding: 0.6rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    color: #f1f5f9;
    font-size: 0.85rem;
  }

  .parameter-item textarea {
    resize: vertical;
    min-height: 90px;
  }

  .parameter-error {
    color: #f87171;
    font-size: 0.8rem;
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
    justify-content: flex-end;
    gap: 1rem;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .modal-content-wrapper {
      max-height: 100dvh;
      border-radius: 0;
    }

    .info-grid {
      grid-template-columns: 1fr 1fr;
    }

    .footer-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .action-buttons {
      justify-content: flex-end;
    }
  }

  /* Conflict Modal Styles */
  .conflict-modal-wrapper {
    background: #1e293b;
    padding: 1.5rem;
    max-height: 80dvh;
    overflow-y: auto;
  }

  .conflict-modal-wrapper h3 {
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
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .conflict-id {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-size: 0.85rem;
    color: #f1f5f9;
  }

  .match-id {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .similarity-badge {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.125rem 0.375rem;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.4);
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
    color: #60a5fa;
  }

  .match-target-select {
    flex: 1;
    min-width: 150px;
    max-width: 250px;
    padding: 0.25rem 0.5rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 4px;
    color: #f1f5f9;
    font-size: 0.8rem;
  }

  .match-target-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .duplicate-warning {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.4);
    border-radius: 6px;
    padding: 0.75rem 1rem;
    color: #eab308;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .conflict-item.duplicate {
    border-color: rgba(234, 179, 8, 0.5);
    background: rgba(234, 179, 8, 0.08);
  }

  .duplicate-badge {
    font-size: 1rem;
    margin-left: 0.25rem;
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
    .conflict-modal-wrapper {
      max-height: 95dvh;
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

  /* Success View Styles */
  .success-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1.5rem;
    text-align: center;
    flex: 1;
  }

  .success-icon {
    font-size: 4rem;
    color: #4ade80;
    margin-bottom: 1.5rem;
    line-height: 1;
  }

  .success-footer {
    justify-content: center;
  }

  .success-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .confirm-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }

  /* Schema Chips Styles */
  .schema-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .schema-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: 6px;
    font-size: 0.75rem;
    line-height: 1.3;
  }

  .schema-chip-name {
    font-family: 'Fira Code', 'Consolas', monospace;
    font-weight: 600;
    color: #60a5fa;
  }

  .schema-chip-label {
    color: #e2e8f0;
  }

  .schema-chip-label::before {
    content: '-';
    margin-right: 0.25rem;
    color: #64748b;
  }

  .schema-chip-type {
    color: #a78bfa;
    font-weight: 500;
  }

  .schema-chip-type::before {
    content: '(';
    color: #64748b;
  }

  .schema-chip-type::after {
    content: ')';
    color: #64748b;
  }

  .schema-chip-constraints {
    color: #fbbf24;
    font-size: 0.7rem;
  }

  .schema-chip-constraints::before {
    content: '|';
    margin-right: 0.25rem;
    color: #64748b;
  }
</style>
