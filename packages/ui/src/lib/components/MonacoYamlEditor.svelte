<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { editor as MonacoEditor, IDisposable, Selection } from 'monaco-editor';
  import { t } from 'svelte-i18n';

  type MonacoInstance = typeof import('monaco-editor');

  // Touch device detection
  let isTouchDevice = $state(false);
  let isToolbarExpanded = $state(false);

  // Global singleton state for Monaco initialization
  let globalMonaco: MonacoInstance | null = null;
  // Use any to avoid type issues with Disposable & update()
  let globalYamlConfig: any | null = null;
  let globalInitPromise: Promise<MonacoInstance> | null = null;

  async function getOrInitializeMonaco(): Promise<MonacoInstance> {
    if (globalMonaco) return globalMonaco;
    if (globalInitPromise) return globalInitPromise;

    globalInitPromise = (async () => {
      // Set up MonacoEnvironment BEFORE importing monaco-editor API
      if (typeof window !== 'undefined') {
        if (!window.MonacoEnvironment) {
          window.MonacoEnvironment = {
            getWorker(_moduleId: string, label: string) {
              if (label === 'yaml') {
                return new YamlWorker();
              }
              return new EditorWorker();
            },
          };
        }
      }

      // Import workers FIRST before anything else (using Vite workaround)
      const EditorWorkerModule = await import('monaco-editor/esm/vs/editor/editor.worker?worker');
      const YamlWorkerModule = await import('$lib/yaml.worker.js?worker');

      const EditorWorker = EditorWorkerModule.default;
      const YamlWorker = YamlWorkerModule.default;

      // Now import Monaco editor and configure yaml
      const monacoModule = await import('monaco-editor/esm/vs/editor/editor.api');
      await import('monaco-editor/esm/vs/editor/contrib/hover/browser/hover');
      await import('monaco-editor/esm/vs/editor/contrib/suggest/browser/suggest');
      await import('monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController');
      await import('monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter');
      await import('monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints');
      await import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution');
      const { configureMonacoYaml } = await import('monaco-yaml');

      const WIN = window as any;
      if (!WIN.__MONACO_YAML_CONFIGURED__) {
        globalYamlConfig = configureMonacoYaml(monacoModule, {
          enableSchemaRequest: true,
          completion: true,
          validate: true,
          hover: true,
          format: true,
          schemas: [], // Initialize empty, update later per editor
        });
        WIN.__MONACO_YAML_CONFIGURED__ = true;
        WIN.__MONACO_YAML_INSTANCE__ = globalYamlConfig;
      } else {
        globalYamlConfig = WIN.__MONACO_YAML_INSTANCE__;
      }

      globalMonaco = monacoModule;
      return monacoModule;
    })();

    return globalInitPromise;
  }

  interface Props {
    value: string;
    onChange?: (nextValue: string) => void;
    readOnly?: boolean;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    placeholder?: string;
    class?: string;
    /**
    /**
     * Optional URI to fetch JSON Schema from.
     * If provided, schema will be applied for autocomplete and validation.
     * @example "./api/schema/homenet-bridge"
     */
    schemaUri?: string;
    mode?: 'monaco' | 'textarea';
  }

  let props: Props = $props();

  let editorHost: HTMLDivElement | null = null;
  let fallbackValue = $state('');
  let isReady = $state(false);
  let isLoading = $state(false);
  let loadError = $state<string | null>(null);

  let editor: MonacoEditor.IStandaloneCodeEditor | null = null;
  let modelChangeDisposable: IDisposable | null = null;
  let monaco: MonacoInstance | null = null;
  let isApplyingExternalChange = false;
  // Derived state to check if we should actually load Monaco
  let shouldLoadMonaco = $derived((props.mode ?? 'monaco') === 'monaco');

  const layoutEditor = async () => {
    if (!editor || !editorHost) return;

    const runLayout = () => {
      if (!editor || !editorHost) return;
      const { width, height } = editorHost.getBoundingClientRect();
      if (width > 0 && height > 0) {
        editor.layout();
      }
    };

    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await nextFrame();
    await nextFrame();
    runLayout();

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // ignore font loading failures and still attempt layout
      }
      await nextFrame();
      runLayout();
    }
  };

  const initializeEditor = async () => {
    if (isLoading || isReady || !editorHost) return;
    if (!shouldLoadMonaco) {
      // In textarea mode, we are "ready" immediately
      // But we might want to ensure fallbackValue is synced
      fallbackValue = props.value;
      return;
    }

    isLoading = true;

    const monacoModule = await getOrInitializeMonaco();
    monaco = monacoModule;

    // Use a fixed URI that matches the schema fileMatch
    // We assume only one editor requires this schema at a time (Modal)
    // If multiple editors are open, we might need a more complex strategy
    const modelUri = monacoModule.Uri.parse(`file:///config.yaml`);

    // Check if model already exists and reuse/dispose it
    // Disposing old model is safer to ensure clean state
    const existingModel = monacoModule.editor.getModel(modelUri);
    if (existingModel) {
      existingModel.dispose();
    }

    // Apply schema configuration
    if (globalYamlConfig && typeof globalYamlConfig.update === 'function') {
      try {
        let schemaConfig: any[] = [];

        // If schemaUri is provided, fetch the schema dynamically
        if (props.schemaUri) {
          try {
            const response = await fetch(props.schemaUri);
            if (response.ok) {
              const schema = await response.json();
              // Convert relative paths to absolute URLs to avoid Monaco YAML parse errors
              let schemaUriAbsolute = props.schemaUri;
              if (
                typeof window !== 'undefined' &&
                (props.schemaUri.startsWith('./') || props.schemaUri.startsWith('/'))
              ) {
                const base = window.location.origin;
                schemaUriAbsolute = new URL(props.schemaUri, base).href;
              }
              schemaConfig = [
                {
                  uri: schemaUriAbsolute,
                  fileMatch: [String(modelUri)], // Exact match with the model URI
                  schema,
                },
              ];
            } else {
              console.warn(`[MonacoYamlEditor] Failed to fetch schema: ${response.status}`);
            }
          } catch (fetchErr) {
            console.warn('[MonacoYamlEditor] Failed to fetch schema:', fetchErr);
          }
        }

        globalYamlConfig.update({
          enableSchemaRequest: true,
          completion: true,
          validate: true,
          hover: true,
          format: true,
          schemas: schemaConfig,
        });
      } catch (e) {
        console.warn('Failed to update yaml config', e);
      }
    }

    // Explicitly set the language to ensure hover/suggest widgets are created for YAML
    const model = monacoModule.editor.createModel(props.value, 'yaml', modelUri);

    editor = monacoModule.editor.create(editorHost, {
      model,
      readOnly: props.readOnly ?? false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 12, bottom: 12 },
      tabSize: 2,
      insertSpaces: true,
      automaticLayout: true,
      hover: { enabled: true },
      // Force suggestion settings
      quickSuggestions: {
        other: true,
        comments: true,
        strings: true,
      },
      suggest: {
        preview: true,
        showWords: false, // Don't show generic text suggestions
        showSnippets: true,
      },
      theme: 'vs-dark',
      ariaLabel: props.ariaLabel ?? 'YAML editor',
    });

    // Ensure readOnly state is correct after creation
    editor.updateOptions({ readOnly: props.readOnly ?? false });
    layoutEditor().catch((err) => {
      console.warn('Failed to layout editor', err);
    });

    modelChangeDisposable = editor.onDidChangeModelContent(() => {
      if (isApplyingExternalChange) return;
      props.onChange?.(editor?.getValue() ?? '');
    });

    isReady = true;
    isLoading = false;
    loadError = null;
  };

  const handleFallbackInput = (event: Event) => {
    const target = event.target as HTMLTextAreaElement;
    fallbackValue = target.value;
    props.onChange?.(fallbackValue);
  };

  // Mobile selection helper functions
  const selectCurrentLine = () => {
    if (!editor || !monaco) return;
    const position = editor.getPosition();
    const model = editor.getModel();
    if (!position || !model) return;

    const line = position.lineNumber;
    editor.setSelection(new monaco.Selection(line, 1, line, model.getLineMaxColumn(line)));
    editor.focus();
  };

  const selectIndentBlock = () => {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    const pos = editor.getPosition();
    if (!model || !pos) return;

    const startLine = pos.lineNumber;
    const lineContent = model.getLineContent(startLine);
    const baseIndent = lineContent.search(/\S|$/);

    // Skip empty lines
    if (lineContent.trim() === '') {
      selectCurrentLine();
      return;
    }

    let start = startLine;
    let end = startLine;

    // Search upward
    while (start > 1) {
      const prevLine = model.getLineContent(start - 1);
      if (prevLine.trim() === '') break; // Stop at empty lines
      const indent = prevLine.search(/\S|$/);
      if (indent < baseIndent) break;
      start--;
    }

    // Search downward
    while (end < model.getLineCount()) {
      const nextLine = model.getLineContent(end + 1);
      if (nextLine.trim() === '') break; // Stop at empty lines
      const indent = nextLine.search(/\S|$/);
      if (indent < baseIndent) break;
      end++;
    }

    editor.setSelection(new monaco.Selection(start, 1, end, model.getLineMaxColumn(end)));
    editor.focus();
  };

  const expandSelectionUp = () => {
    if (!editor || !monaco) return;
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model) return;

    const newStartLine = Math.max(1, selection.startLineNumber - 1);
    editor.setSelection(
      new monaco.Selection(
        newStartLine,
        1,
        selection.endLineNumber,
        model.getLineMaxColumn(selection.endLineNumber),
      ),
    );
    editor.focus();
  };

  const expandSelectionDown = () => {
    if (!editor || !monaco) return;
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model) return;

    const newEndLine = Math.min(model.getLineCount(), selection.endLineNumber + 1);
    editor.setSelection(
      new monaco.Selection(
        selection.startLineNumber,
        1,
        newEndLine,
        model.getLineMaxColumn(newEndLine),
      ),
    );
    editor.focus();
  };

  const selectAll = () => {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    editor.setSelection(model.getFullModelRange());
    editor.focus();
    isToolbarExpanded = false; // Close menu after action
  };

  onMount(() => {
    // Detect touch device
    isTouchDevice =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (navigator as any).msMaxTouchPoints > 0;

    fallbackValue = props.value;
    initializeEditor().catch((err) => {
      loadError = err instanceof Error ? err.message : 'Failed to load editor';
      isLoading = false;
    });
  });

  onDestroy(() => {
    modelChangeDisposable?.dispose();
    const model = editor?.getModel();
    editor?.dispose();
    if (model) model.dispose(); // Always dispose model to clean up file:///config.yaml
    editor = null;
    monaco = null;
  });

  $effect(() => {
    fallbackValue = props.value;

    if (!editor) return;
    if (props.value === editor.getValue()) return;

    isApplyingExternalChange = true;
    editor.setValue(props.value);
    isApplyingExternalChange = false;
  });

  $effect(() => {
    const readOnly = props.readOnly ?? false;
    if (!editor) return;
    editor.updateOptions({ readOnly });
  });

  $effect(() => {
    // If mode switches to textarea, we should dispose Monaco if it exists
    if (!shouldLoadMonaco && editor) {
      modelChangeDisposable?.dispose();
      const model = editor?.getModel();
      if (model) model.dispose();
      editor?.dispose();
      editor = null;
      isReady = false;
    } else if (shouldLoadMonaco && !editor && !isLoading) {
      // If mode switches to monaco and it's not loaded, load it
      // initializeEditor check checks isLoading/isReady
      initializeEditor().catch((err) => {
        loadError = err instanceof Error ? err.message : 'Failed to load editor';
        isLoading = false;
      });
    }
  });
</script>

<div
  class={`monaco-yaml-editor ${props.class ?? ''}`}
  aria-label={props.ariaLabel ?? 'YAML editor'}
  aria-describedby={props.ariaDescribedBy}
  aria-busy={isLoading}
>
  {#if !isReady || !shouldLoadMonaco}
    <textarea
      class="fallback-textarea"
      class:visible={!shouldLoadMonaco}
      bind:value={fallbackValue}
      spellcheck="false"
      placeholder={props.placeholder ?? ''}
      readonly={props.readOnly ?? false}
      oninput={handleFallbackInput}
    ></textarea>
    {#if loadError && shouldLoadMonaco}
      <div class="load-error" role="alert">{loadError}</div>
    {/if}
  {/if}
  <div class="monaco-host" class:ready={isReady && shouldLoadMonaco} bind:this={editorHost}></div>

  <!-- Mobile floating toolbar -->
  {#if isTouchDevice && isReady && !props.readOnly}
    <div class="mobile-toolbar-wrapper">
      {#if isToolbarExpanded}
        <div
          class="mobile-toolbar-menu"
          role="toolbar"
          aria-label={$t('editor.mobile.toolbar_label') || 'Selection tools'}
        >
          <button
            type="button"
            class="toolbar-btn"
            onclick={selectCurrentLine}
            title={$t('editor.mobile.select_line') || 'Select line'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="toolbar-icon"
            >
              <line x1="3" y1="12" x2="21" y2="12"></line>
            </svg>
            <span class="toolbar-label">{$t('editor.mobile.select_line')}</span>
          </button>
          <button
            type="button"
            class="toolbar-btn"
            onclick={selectIndentBlock}
            title={$t('editor.mobile.select_block') || 'Select block'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="toolbar-icon"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            </svg>
            <span class="toolbar-label">{$t('editor.mobile.select_block')}</span>
          </button>
          <div class="toolbar-row">
            <button
              type="button"
              class="toolbar-btn half"
              onclick={expandSelectionUp}
              title={$t('editor.mobile.expand_up') || 'Expand up'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="toolbar-icon"
              >
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
              <span class="toolbar-label">{$t('editor.mobile.expand_up')}</span>
            </button>
            <button
              type="button"
              class="toolbar-btn half"
              onclick={expandSelectionDown}
              title={$t('editor.mobile.expand_down') || 'Expand down'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="toolbar-icon"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
              <span class="toolbar-label">{$t('editor.mobile.expand_down')}</span>
            </button>
          </div>
          <button
            type="button"
            class="toolbar-btn"
            onclick={selectAll}
            title={$t('editor.mobile.select_all') || 'Select all'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="toolbar-icon"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="3" y1="15" x2="21" y2="15"></line>
            </svg>
            <span class="toolbar-label">{$t('editor.mobile.select_all')}</span>
          </button>
        </div>
      {/if}

      <button
        type="button"
        class="toolbar-toggle-btn"
        class:expanded={isToolbarExpanded}
        onclick={() => (isToolbarExpanded = !isToolbarExpanded)}
        aria-label={isToolbarExpanded ? 'Close toolbar' : 'Open toolbar'}
      >
        {#if isToolbarExpanded}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="toggle-icon"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        {:else}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="toggle-icon"
          >
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="19" cy="12" r="1"></circle>
            <circle cx="5" cy="12" r="1"></circle>
          </svg>
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .monaco-yaml-editor {
    position: relative;
  }

  .monaco-host {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    touch-action: manipulation;
  }

  .monaco-host.ready {
    opacity: 1;
    pointer-events: auto;
  }

  .monaco-host,
  .monaco-host * {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  .fallback-textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    resize: none;
    outline: none;
    opacity: 1; /* Ensure visible when fallback logic dictates */
  }

  .fallback-textarea.visible {
    opacity: 1;
    z-index: 10;
    pointer-events: auto;
  }

  .load-error {
    position: absolute;
    bottom: 0.5rem;
    left: 0.75rem;
    right: 0.75rem;
    font-size: 0.8rem;
    color: #fca5a5;
  }

  /* Mobile floating toolbar */
  .mobile-toolbar-wrapper {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end; /* Align toggle button and menu to the right */
    gap: 12px;
    z-index: 100;
  }

  /* Menu Container */
  .mobile-toolbar-menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(30, 30, 30, 0.95);
    backdrop-filter: blur(8px);
    border-radius: 12px;
    padding: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    min-width: 150px;
    transform-origin: bottom right;
    animation: slideUp 0.15s ease-out;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: scale(0.9) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .toolbar-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(59, 130, 246, 0.9); /* Primary color */
    color: white;
    border: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .toolbar-toggle-btn:active {
    transform: scale(0.9);
  }

  .toolbar-toggle-btn.expanded {
    background: rgba(60, 60, 60, 0.9); /* Darker when expanded */
    transform: rotate(90deg);
  }

  .toggle-icon {
    width: 24px;
    height: 24px;
  }

  .toolbar-row {
    display: flex;
    gap: 8px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    height: 42px;
    padding: 0 12px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    color: #e0e0e0;
    cursor: pointer;
    transition: background 0.2s ease;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    overflow: hidden;
  }

  .toolbar-btn.half {
    flex: 1;
    padding: 0 6px;
    justify-content: center;
  }

  .toolbar-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .toolbar-btn:active {
    background: rgba(59, 130, 246, 0.6);
  }

  .toolbar-icon {
    width: 20px;
    height: 20px;
    min-width: 20px;
    flex-shrink: 0;
  }

  .toolbar-label {
    margin-left: 10px;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }

  .toolbar-btn.half .toolbar-label {
    margin-left: 6px;
    font-size: 11px;
  }

  /* Ensure monaco widgets appear above modals */
  :global(.monaco-editor .suggest-widget),
  :global(.monaco-editor .monaco-hover) {
    z-index: 2147483647 !important;
    max-width: 80vw !important;
    visibility: visible !important;
  }
</style>
