<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { editor as MonacoEditor, IDisposable } from 'monaco-editor';
  import type { MonacoYaml } from 'monaco-yaml';

  type MonacoInstance = typeof import('monaco-editor');

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
      await import('monaco-editor/esm/vs/editor/contrib/hover/hover');
      await import('monaco-editor/esm/vs/editor/contrib/suggest/suggest');
      await import('monaco-editor/esm/vs/editor/contrib/wordHighlighter/wordHighlighter');
      await import('monaco-editor/esm/vs/editor/contrib/parameterHints/parameterHints');
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

  const initializeEditor = async () => {
    if (isLoading || isReady || !editorHost) return;

    isLoading = true;

    const monacoModule = await getOrInitializeMonaco();
    monaco = monacoModule;

    // Force update schema configuration with a test schema
    // In a real app, you would pass the schema as a prop or fetch it
    if (globalYamlConfig && typeof globalYamlConfig.update === 'function') {
      try {
        globalYamlConfig.update({
          enableSchemaRequest: true,
          completion: true,
          validate: true,
          hover: true,
          format: true,
          schemas: [
            {
              uri: 'http://myschema/config.json',
              fileMatch: ['config.yaml'], // Exact match
              schema: {
                type: 'object',
                properties: {
                  test_key: {
                    type: 'string',
                    description: 'It works! This is a description from the schema.',
                  },
                  homenet_bridge: {
                    type: 'object',
                    description: 'Main bridge configuration',
                    additionalProperties: true,
                  },
                },
              },
            },
          ],
        });
      } catch (e) {
        console.warn('Failed to update yaml config', e);
      }
    }

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
      quickSuggestions: true,
      theme: 'vs-dark',
      ariaLabel: props.ariaLabel ?? 'YAML editor',
    });

    // Ensure readOnly state is correct after creation
    editor.updateOptions({ readOnly: props.readOnly ?? false });

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

  onMount(() => {
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
</script>

<div
  class={`monaco-yaml-editor ${props.class ?? ''}`}
  aria-label={props.ariaLabel ?? 'YAML editor'}
  aria-describedby={props.ariaDescribedBy}
  aria-busy={isLoading}
>
  {#if !isReady}
    <textarea
      class="fallback-textarea"
      bind:value={fallbackValue}
      spellcheck="false"
      placeholder={props.placeholder ?? ''}
      readonly={props.readOnly ?? false}
      oninput={handleFallbackInput}
    ></textarea>
    {#if loadError}
      <div class="load-error" role="alert">{loadError}</div>
    {/if}
  {/if}
  <div class="monaco-host" class:ready={isReady} bind:this={editorHost}></div>
</div>

<style>
  .monaco-yaml-editor {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .monaco-host {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  .monaco-host.ready {
    opacity: 1;
    pointer-events: auto;
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
  }

  .load-error {
    position: absolute;
    bottom: 0.5rem;
    left: 0.75rem;
    right: 0.75rem;
    font-size: 0.8rem;
    color: #fca5a5;
  }

  /* Ensure monaco widgets appear above modals */
  :global(.monaco-editor .suggest-widget),
  :global(.monaco-editor .monaco-hover) {
    z-index: 2147483647 !important;
    max-width: 80vw !important;
    visibility: visible !important;
  }
</style>
