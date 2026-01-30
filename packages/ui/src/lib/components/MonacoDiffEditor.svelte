<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { editor as MonacoEditor } from 'monaco-editor';
  import 'monaco-editor/min/vs/editor/editor.main.css';

  type MonacoInstance = typeof import('monaco-editor');

  // Global singleton state for Monaco initialization (Shared logic pattern)
  // Note: In a larger refactor, this logic should be moved to a shared utility.
  let globalMonaco: MonacoInstance | null = null;
  let globalInitPromise: Promise<MonacoInstance> | null = null;
  // We reuse the same configuration flag from MonacoYamlEditor if possible,
  // but we primarily need the base Monaco instance here.

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

      // Import workers
      const EditorWorkerModule = await import(
        'monaco-editor/esm/vs/editor/editor.worker.js?worker'
      );
      const YamlWorkerModule = await import('$lib/yaml.worker.js?worker');

      const EditorWorker = EditorWorkerModule.default;
      const YamlWorker = YamlWorkerModule.default;

      // Import Monaco editor
      const monacoModule = await import('monaco-editor/esm/vs/editor/editor.api');
      await import('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution');

      // We don't strictly need detailed YAML config for read-only diff,
      // but importing it ensures language support is loaded.
      await import('monaco-yaml');

      globalMonaco = monacoModule;
      return monacoModule;
    })();

    return globalInitPromise;
  }

  interface Props {
    original: string;
    modified: string;
    class?: string;
  }

  let { original, modified, class: className }: Props = $props();

  let editorHost: HTMLDivElement | null = null;
  let isReady = $state(false);
  let isLoading = $state(false);
  let loadError = $state<string | null>(null);

  let diffEditor: MonacoEditor.IStandaloneDiffEditor | null = null;
  let originalModel: MonacoEditor.ITextModel | null = null;
  let modifiedModel: MonacoEditor.ITextModel | null = null;
  let monaco: MonacoInstance | null = null;

  const layoutEditor = async () => {
    if (!diffEditor || !editorHost) return;

    const runLayout = () => {
      if (!diffEditor || !editorHost) return;
      const { width, height } = editorHost.getBoundingClientRect();
      if (width > 0 && height > 0) {
        diffEditor.layout();
      }
    };

    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await nextFrame();
    runLayout();
    // Retry layout for safety
    await nextFrame();
    runLayout();
  };

  const initializeEditor = async () => {
    if (isLoading || isReady || !editorHost) return;
    isLoading = true;

    try {
      const monacoModule = await getOrInitializeMonaco();
      monaco = monacoModule;

      originalModel = monacoModule.editor.createModel(original, 'yaml');
      modifiedModel = monacoModule.editor.createModel(modified, 'yaml');

      diffEditor = monacoModule.editor.createDiffEditor(editorHost, {
        originalEditable: false,
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        automaticLayout: true,
        renderSideBySide: true, // Side by side diff
        theme: 'vs-dark',
        scrollbar: {
          vertical: 'visible',
          horizontal: 'visible',
        },
        fontFamily: "'Fira Code', 'Consolas', 'Monaco', 'Droid Sans Mono', 'monospace', monospace",
      });

      diffEditor.setModel({
        original: originalModel,
        modified: modifiedModel,
      });

      isReady = true;
      isLoading = false;
      loadError = null;

      layoutEditor();
    } catch (err) {
      console.warn('Failed to load Monaco Diff Editor', err);
      loadError = err instanceof Error ? err.message : 'Failed to load editor';
      isLoading = false;
    }
  };

  onMount(() => {
    initializeEditor();
  });

  onDestroy(() => {
    originalModel?.dispose();
    modifiedModel?.dispose();
    diffEditor?.dispose();
    diffEditor = null;
    monaco = null;
  });

  // Watch for prop changes
  $effect(() => {
    if (!diffEditor || !monaco || !originalModel || !modifiedModel) return;

    // Update models if content changes
    if (original !== originalModel.getValue()) {
      originalModel.setValue(original);
    }
    if (modified !== modifiedModel.getValue()) {
      modifiedModel.setValue(modified);
    }
  });
</script>

<div class={`monaco-diff-editor ${className ?? ''}`}>
  {#if !isReady}
    <div class="loading-placeholder">Loading Diff Editor...</div>
  {/if}
  {#if loadError}
    <div class="error-message">
      {loadError}
    </div>
  {/if}
  <div class="monaco-host" class:ready={isReady} bind:this={editorHost}></div>
</div>

<style>
  .monaco-diff-editor {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 300px; /* Default min-height */
    background: #1e1e1e;
    border-radius: 4px;
    overflow: hidden;
  }

  .monaco-host {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .monaco-host.ready {
    opacity: 1;
  }

  .loading-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 0.9rem;
  }

  .error-message {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #ff6b6b;
  }
</style>
