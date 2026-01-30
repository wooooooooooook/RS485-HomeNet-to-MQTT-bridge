<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import Button from './Button.svelte';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';
  import Modal from './Modal.svelte';
  import Dialog from './Dialog.svelte';
  import { triggerSystemRestart as restartApp } from '../utils/appControl';
  import type {
    GalleryDiscoveryResult,
    GalleryItemForPreview,
    GalleryMatch,
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
  let openDropdownMatchId = $state<string | null>(null);

  function toggleDropdown(matchId: string, event: MouseEvent) {
    event.stopPropagation();
    if (openDropdownMatchId === matchId) {
      openDropdownMatchId = null;
    } else {
      openDropdownMatchId = matchId;
    }
  }

  function handleWindowClick() {
    openDropdownMatchId = null;
  }

  function selectOption(matchId: string, candidateMatchId: string) {
    matchTargets[matchId] = candidateMatchId;
    matchActions[matchId] = 'overwrite';
    openDropdownMatchId = null;
  }

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

  function processYamlForDiff(
    content: string,
    fieldsToRemove: string[],
    overrides: Record<string, string> = {},
  ) {
    if (!content) return '';

    // Use regex-based line processing to preserve comments, hex values, and array formats
    const lines = content.split('\n');
    const resultLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match top-level keys (start of line, allowing spaces, match key followed by colon)
      // Note: We assume top-level keys have no indentation or consistent indentation.
      // For simple single-level diffs, this regex handles keys at start of line.
      const keyMatch = line.match(/^\s*([a-zA-Z0-9_]+):/);

      if (keyMatch) {
        const key = keyMatch[1];

        if (fieldsToRemove.includes(key)) {
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          const rawValue = overrides[key];
          // Use raw value directly to preserve quoting style from existing content
          resultLines.push(`${key}: ${rawValue}`);
          continue;
        }
      }

      resultLines.push(line);
    }

    return resultLines.join('\n');
  }

  function getOriginalDiffContent(action: string, content: string) {
    if (action === 'add') return '';
    if (action === 'overwrite') {
      return processYamlForDiff(content, ['type', 'unique_id']);
    }
    return content;
  }

  function getRawValueFromContent(content: string, key: string): string | undefined {
    // Regex to find "key: value" and capture the value part.
    // Handles potential leading spaces.
    const regex = new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm');
    const match = content.match(regex);
    return match ? match[1] : undefined;
  }

  function getModifiedDiffContent(
    action: string,
    newContent: string,
    existingContent: string,
    matchId: string,
  ) {
    if (action === 'overwrite') {
      const overrides: Record<string, string> = {};

      const existingId = getRawValueFromContent(existingContent, 'id');
      if (existingId !== undefined) {
        overrides['id'] = existingId;
      }

      const existingName = getRawValueFromContent(existingContent, 'name');
      if (existingName !== undefined) {
        overrides['name'] = existingName;
      }

      // Also remove type/unique_id to match original side filtering
      return processYamlForDiff(newContent, ['type', 'unique_id'], overrides);
    } else if (action === 'add') {
      // If adding with a new ID (rename), reflect it in the diff
      const newId = renames[matchId];
      if (newId && newId !== matchId) {
        // Use raw string for ID, assuming simple string without quotes needed for display
        return processYamlForDiff(newContent, [], { id: newId });
      }
    }
    return newContent;
  }

  function checkDuplicateId(match: GalleryMatch, id: string): boolean {
    if (!id || !match.candidates) return false;
    // Check if the input ID exists in the candidate list (which contains all entities of the same type)
    return match.candidates.some((c) => c.matchId === id);
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
          let selectedTarget = match.matchedId;

          // If no matchedId (New Item), default to first candidate if available
          if (!selectedTarget && match.candidates && match.candidates.length > 0) {
            // Find first unused candidate if possible
            for (const candidate of match.candidates) {
              if (!usedTargets.has(candidate.matchId)) {
                selectedTarget = candidate.matchId;
                break;
              }
            }
            // Fallback to first candidate if all used
            if (!selectedTarget) {
              selectedTarget = match.candidates[0].matchId;
            }
          }

          // Default action: 'overwrite' if matchedId exists (Conflict/High Match), otherwise 'add'
          actions[match.id] = match.matchedId ? 'overwrite' : 'add';
          targets[match.id] = selectedTarget;

          // Mark target as used if we are overwriting by default
          if (actions[match.id] === 'overwrite' && selectedTarget) {
            usedTargets.add(selectedTarget);
          }
        }

        return { actions, targets };
      }

      const { actions: defaultActions, targets: defaultTargets } = initializeMatchTargets();

      // Clear and update reactive objects to maintain proxy reactivity (Svelte 5)
      // Reassigning with a plain object would lose deep reactivity for subsequent mutations.
      for (const key in matchActions) delete matchActions[key];
      for (const key in matchTargets) delete matchTargets[key];

      Object.assign(matchActions, defaultActions);
      Object.assign(matchTargets, defaultTargets);

      // Force show conflict modal if there are any matches (integrated list)
      if (matches.length > 0) {
        showConflictModal = true;
        resolutions = {}; // Clear old resolutions
        renames = {};
      } else if (compatibility && !compatibility.compatible && !forceApply) {
        showConflictModal = true;
      } else {
        // No items to process and compatible, apply directly (rare case if matches handles everything)
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
  width="900px"
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
                {$t('gallery.preview.preview_button')}
              {/if}
            </Button>
          </div>
        </div>
      </footer>
    {/if}
  </div>
</Modal>

<svelte:window onclick={handleWindowClick} />

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
    {/if}

    {#if matches.length > 0}
      <h3>{$t('gallery.preview.match_detected')}</h3>

      {#if duplicateTargets.size > 0}
        <div class="duplicate-warning">
          ⚠️ {$t('gallery.preview.duplicate_target_warning')}
        </div>
      {/if}

      <div class="conflict-list">
        {#each matches as match (match.id)}
          {@const selectedTarget = matchTargets[match.id] || match.matchedId}
          {@const selectedCandidate = match.candidates?.find((c) => c.matchId === selectedTarget)}
          {@const selectedExistingYaml = selectedCandidate?.existingYaml || match.existingYaml}
          {@const isDuplicate =
            duplicateTargets.has(selectedTarget) && matchActions[match.id] === 'overwrite'}
          <div
            class="conflict-item"
            class:duplicate={isDuplicate}
            class:skipped={matchActions[match.id] === 'skip'}
          >
            <div class="conflict-header">
              <span class="conflict-id">
                <span class="item-type-label">{formatItemLabel(match.type, match.entityType)}</span>
                ID: <strong>{match.id}</strong>
              </span>
              {#if match.candidates && match.candidates.length > 0}
                {#if matchActions[match.id] === 'overwrite'}
                  <div class="target-wrapper">
                    <span class="target-label">{$t('gallery.preview.target_label')}</span>
                    <!-- Custom Dropdown -->
                    <div class="custom-select-container">
                      <button
                        class="select-trigger"
                        onclick={(e) => toggleDropdown(match.id, e)}
                        class:active={openDropdownMatchId === match.id}
                      >
                        <span class="trigger-text">
                          {#if selectedCandidate}
                            {selectedCandidate.matchId} ({Math.round(
                              selectedCandidate.similarity * 100,
                            )}%)
                            {#if selectedCandidate.name}
                              - {selectedCandidate.name}
                            {/if}
                          {:else}
                            Select Target
                          {/if}
                        </span>
                        <span class="trigger-arrow">▼</span>
                      </button>

                      {#if openDropdownMatchId === match.id}
                        <div
                          class="select-options"
                          role="listbox"
                          tabindex="-1"
                          onclick={(e) => e.stopPropagation()}
                          onkeydown={(e) => e.stopPropagation()}
                        >
                          {#each match.candidates as candidate}
                            <div
                              class="select-option"
                              role="option"
                              aria-selected={selectedTarget === candidate.matchId}
                              tabindex="0"
                              class:selected={selectedTarget === candidate.matchId}
                              class:high-match={candidate.similarity >= 0.8}
                              onclick={() => selectOption(match.id, candidate.matchId)}
                              onkeydown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  selectOption(match.id, candidate.matchId);
                                }
                              }}
                            >
                              <div class="option-row-1">
                                <span class="option-id">{candidate.matchId}</span>
                                <span class="option-percent">
                                  ({$t('gallery.preview.match_rate', {
                                    values: { n: Math.round(candidate.similarity * 100) },
                                  })})
                                </span>
                              </div>
                              {#if candidate.name}
                                <div class="option-row-2">
                                  {candidate.name}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/if}
              {:else}
                <span class="match-id">
                  <!-- No candidates available -->
                </span>
              {/if}
              {#if isDuplicate}
                <span class="duplicate-badge">⚠️</span>
              {/if}
              {#if matchActions[match.id] !== 'skip'}
                <button class="toggle-diff-btn" onclick={() => toggleDiff(`match-${match.id}`)}>
                  {expandedDiffs.has(`match-${match.id}`) ? '▲' : '▼'}
                  {$t('gallery.preview.diff_title')}
                </button>
              {/if}
            </div>

            <div class="resolution-options">
              <label class="resolution-option">
                <input
                  type="radio"
                  name="match-resolution-{match.id}"
                  value="overwrite"
                  checked={matchActions[match.id] === 'overwrite'}
                  onchange={() => (matchActions[match.id] = 'overwrite')}
                  disabled={(!match.candidates || match.candidates.length === 0) &&
                    (match.similarity ?? 0) < 0.8}
                />
                {$t('gallery.preview.resolution.overwrite')}
              </label>

              <label class="resolution-option">
                <input
                  type="radio"
                  name="match-resolution-{match.id}"
                  value="skip"
                  checked={matchActions[match.id] === 'skip'}
                  onchange={() => (matchActions[match.id] = 'skip')}
                />
                {$t('gallery.preview.resolution.skip')}
              </label>

              <label class="resolution-option">
                <input
                  type="radio"
                  name="match-resolution-{match.id}"
                  value="add"
                  checked={matchActions[match.id] === 'add'}
                  onchange={() => {
                    matchActions[match.id] = 'add';
                    // Initialize rename with original ID if not set
                    if (!renames[match.id]) {
                      renames[match.id] = match.id;
                    }
                  }}
                />
                {$t('gallery.preview.resolution.add_new')}
              </label>

              {#if matchActions[match.id] === 'add'}
                <div class="new-id-input-wrapper">
                  <span class="new-id-label">New ID:</span>
                  <input
                    type="text"
                    class="new-id-input"
                    class:error={checkDuplicateId(match, renames[match.id] || match.id)}
                    value={renames[match.id] || match.id}
                    oninput={(e) => {
                      const val = e.currentTarget.value;
                      renames[match.id] = val;
                    }}
                  />
                  {#if checkDuplicateId(match, renames[match.id] || match.id)}
                    <span class="new-id-error">ID already exists</span>
                  {/if}
                </div>
              {/if}
            </div>

            {#if expandedDiffs.has(`match-${match.id}`) && matchActions[match.id] !== 'skip'}
              <div class="diff-container monaco-view">
                {#key `${matchActions[match.id]}-${selectedTarget}`}
                  <MonacoDiffEditor
                    original={getOriginalDiffContent(matchActions[match.id], selectedExistingYaml)}
                    modified={getModifiedDiffContent(
                      matchActions[match.id],
                      match.newYaml,
                      selectedExistingYaml,
                      match.id,
                    )}
                  />
                {/key}
              </div>
            {/if}
          </div>
        {/each}
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
    max-height: 85dvh;
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

  .new-id-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    margin-left: 1.8rem; /* Align with radio text */
  }

  .new-id-label {
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .new-id-input {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid #334155;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    color: #e2e8f0;
    font-size: 0.85rem;
    font-family: 'Fira Code', monospace;
  }

  .new-id-input:focus {
    outline: none;
    border-color: #3b82f6;
  }

  .new-id-input.error {
    border-color: #ef4444;
  }

  .new-id-error {
    font-size: 0.75rem;
    color: #ef4444;
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
    max-height: 90dvh;
    overflow-y: auto;
  }

  .conflict-modal-wrapper h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.5rem 0.5rem;
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

  .conflict-item.skipped .conflict-header {
    opacity: 0.5;
    text-decoration: line-through;
  }

  .conflict-item.skipped .conflict-id strong {
    color: #94a3b8;
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

  .item-type-label {
    display: inline-block;
    padding: 0.15rem 0.4rem;
    margin-right: 0.5rem;
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: 3px;
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.4);
  }

  .target-label {
    margin-right: 0.5rem;
    font-size: 0.9em;
    color: #94a3b8;
  }

  .match-id {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .custom-select-container {
    position: relative;
    flex: 1;
    min-width: 200px;
    max-width: 500px;
  }

  .select-trigger {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 4px;
    color: #f1f5f9;
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
  }

  .select-trigger:hover {
    border-color: rgba(148, 163, 184, 0.5);
  }

  .select-trigger.active {
    border-color: #3b82f6;
  }

  .trigger-text {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-right: 0.5rem;
  }

  .trigger-arrow {
    font-size: 0.7rem;
    color: #94a3b8;
  }

  .select-options {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: #1e293b;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
    max-height: 250px;
    overflow-y: auto;
    z-index: 50;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  .select-option {
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    transition: background 0.15s ease;
  }

  .select-option:last-child {
    border-bottom: none;
  }

  .select-option:hover {
    background: rgba(148, 163, 184, 0.1);
  }

  .select-option.selected {
    background: rgba(59, 130, 246, 0.15);
    border-left: 2px solid #3b82f6;
  }

  .select-option.high-match {
    background: rgba(16, 185, 129, 0.15); /* Green tint */
    border-left: 2px solid #10b981;
  }

  .select-option.high-match:hover {
    background: rgba(16, 185, 129, 0.25);
  }

  /* Selected overrides high-match if active */
  .select-option.selected.high-match {
    background: rgba(16, 185, 129, 0.3);
    border-left-color: #10b981;
  }

  .option-row-1 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.1rem;
  }

  .option-id {
    font-family: 'Fira Code', monospace;
    font-weight: 600;
    color: #f1f5f9;
    font-size: 0.85rem;
  }

  .option-percent {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .select-option.high-match .option-percent {
    color: #34d399; /* Green text */
    font-weight: 600;
  }

  .option-row-2 {
    font-size: 0.8rem;
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    margin-top: 0.5rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    background: #1e1e1e;
    height: 400px;
    overflow: hidden;
    position: relative;
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
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #94a3b8;
    cursor: pointer;
    padding: 0.4rem 0.8rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
    background: rgba(30, 41, 59, 0.5);
    transition: all 0.2s ease;
  }

  .resolution-option:hover {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.4);
  }

  /* 라디오 버튼 숨기기 (선택적) 또는 기본 스타일 유지 */
  .resolution-option input[type='radio'] {
    accent-color: #3b82f6;
    margin: 0;
  }

  @media (max-width: 640px) {
    .conflict-modal-wrapper {
      padding: 1.5rem 0.5rem;
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

  /* Success View Styles */
  .success-view {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    flex: 1;
  }

  .success-icon {
    font-size: 2rem;
    color: #4ade80;
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
