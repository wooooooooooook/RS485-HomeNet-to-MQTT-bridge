<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
  import type { CompletionContext } from '@codemirror/autocomplete';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
  import { tags } from '@lezer/highlight';
  import { lintGutter, linter, type Diagnostic } from '@codemirror/lint';
  import { EditorState, Compartment } from '@codemirror/state';
  import { EditorView, keymap, highlightActiveLine, placeholder } from '@codemirror/view';
  import { yaml } from '@codemirror/lang-yaml';
  import { isMap, isSeq, isScalar, parseDocument } from 'yaml';
  import {
    automationKeys,
    bridgeKeys,
    checksumSuggestions,
    entityKeys,
    entityTypes,
    packetDefaultKeys,
    scriptKeys,
    serialKeys,
    serialValueSuggestions,
  } from '../utils/yamlEditorConfig.js';
  import validateAutomationConfig from '../utils/yamlAutomationValidator';
  import validateEntityConfig from '../utils/yamlEntityValidator';
  import validateScriptConfig from '../utils/yamlScriptValidator';
  import validateYamlConfig from '../utils/yamlConfigValidator';

  type EditorMode = 'bridge' | 'entity' | 'script' | 'automation';

  let {
    value = $bindable(''),
    disabled = false,
    ariaLabel = '',
    ariaDescribedBy,
    placeholderText,
    class: className = '',
    mode = 'bridge',
  }: {
    value?: string;
    disabled?: boolean;
    ariaLabel?: string;
    ariaDescribedBy?: string;
    placeholderText?: string;
    class?: string;
    mode?: EditorMode;
  } = $props();

  let editorHost: HTMLDivElement | null = $state(null);
  let view: EditorView | null = $state(null);
  let diagnostics = $state<Diagnostic[]>([]);

  const editableCompartment = new Compartment();
  const placeholderCompartment = new Compartment();

  type SchemaValidationError = {
    instancePath: string;
    message?: string;
  };

  const schemaValidators: Record<
    EditorMode,
    typeof validateYamlConfig & { errors?: SchemaValidationError[] }
  > = {
    bridge: validateYamlConfig,
    entity: validateEntityConfig,
    script: validateScriptConfig,
    automation: validateAutomationConfig,
  };

  const buildDiagnostics = (text: string) => {
    const doc = parseDocument(text, { prettyErrors: false });
    const nextDiagnostics: Diagnostic[] = [];

    if (doc.errors.length > 0) {
      doc.errors.forEach((error) => {
        const pos = Array.isArray(error.pos) ? error.pos[0] : (error.pos ?? 0);
        nextDiagnostics.push({
          from: Math.max(0, pos),
          to: Math.min(text.length, Math.max(0, pos + 1)),
          severity: 'error',
          message: `${$t('editor.yaml_syntax_error')}: ${error.message}`,
        });
      });
      return nextDiagnostics;
    }

    const data = doc.toJS({});
    const schemaValidator = schemaValidators[mode];
    const valid = schemaValidator(data);

    if (!valid && schemaValidator.errors) {
      schemaValidator.errors.forEach((error) => {
        const range = findRangeForPath(doc, error.instancePath);
        nextDiagnostics.push({
          from: range?.from ?? 0,
          to: range?.to ?? Math.min(1, text.length),
          severity: 'warning',
          message: `${$t('editor.yaml_schema_warning')}: ${error.message ?? 'invalid value'}`,
        });
      });
    }

    const customDiagnostics = buildCustomDiagnostics(data, doc, text);
    nextDiagnostics.push(...customDiagnostics);

    return nextDiagnostics;
  };

  const yamlLinter = linter((view) => {
    const text = view.state.doc.toString();
    diagnostics = buildDiagnostics(text);
    return diagnostics;
  });

  const getPathAtPosition = (doc: EditorState['doc'], pos: number) => {
    const lineInfo = doc.lineAt(pos);
    const stack: { indent: number; key: string }[] = [];

    for (let i = 1; i <= lineInfo.number; i += 1) {
      const line = doc.line(i).text;
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const mapMatch = line.match(/^(\s*)([^:\n]+):/);
      if (mapMatch && !line.trimStart().startsWith('-')) {
        const indent = mapMatch[1].length;
        const key = mapMatch[2].trim();

        while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
          stack.pop();
        }
        stack.push({ indent, key });
      }
    }

    return stack.map((entry) => entry.key);
  };

  const getContextKey = (doc: EditorState['doc'], pos: number) => {
    const lineInfo = doc.lineAt(pos);
    const beforeCursor = lineInfo.text.slice(0, pos - lineInfo.from);
    const match = beforeCursor.match(/([\w-]+)\s*:\s*([^\s]*)?$/);
    if (!match) return null;
    return match[1];
  };

  const getCompletionEntries = (docText: string, path: string[]) => {
    const doc = parseDocument(docText, { prettyErrors: false });
    const data = doc.toJS({}) as Record<string, any> | null;
    const completions = new Set<string>();

    if (mode === 'entity') {
      entityKeys.forEach((key) => completions.add(key));
      return Array.from(completions).map((label) => ({ label, type: 'property' as const }));
    }

    if (mode === 'script') {
      scriptKeys.forEach((key) => completions.add(key));
      return Array.from(completions).map((label) => ({ label, type: 'property' as const }));
    }

    if (mode === 'automation') {
      automationKeys.forEach((key) => completions.add(key));
      return Array.from(completions).map((label) => ({ label, type: 'property' as const }));
    }

    if (path.length === 0) {
      completions.add('homenet_bridge');
    }

    if (path[0] === 'homenet_bridge') {
      bridgeKeys.forEach((key) => completions.add(key));
    }

    if (path.includes('serial')) {
      serialKeys.forEach((key) => completions.add(key));
    }

    if (path.includes('packet_defaults')) {
      packetDefaultKeys.forEach((key) => completions.add(key));
    }

    if (path.some((segment) => entityTypes.includes(segment))) {
      entityKeys.forEach((key) => completions.add(key));
    }

    const docBridge = data?.homenet_bridge;
    if (docBridge && typeof docBridge === 'object') {
      Object.keys(docBridge).forEach((key) => completions.add(key));
    }

    return Array.from(completions).map((label) => ({ label, type: 'property' as const }));
  };

  const completionSource = (context: CompletionContext) => {
    const doc = context.state.doc;
    const docText = doc.toString();
    const path = getPathAtPosition(doc, context.pos);
    const currentKey = getContextKey(doc, context.pos);

    if (currentKey && mode === 'bridge') {
      const valueSuggestions = buildValueCompletions(currentKey);
      if (valueSuggestions.length > 0) {
        return {
          from: context.pos,
          options: valueSuggestions,
        };
      }
    }

    const options = getCompletionEntries(docText, path);
    if (options.length === 0) return null;
    return {
      from: context.pos,
      options,
      validFor: /^[\w-]*$/,
    };
  };

  const buildValueCompletions = (key: string) => {
    const options: { label: string; type: string }[] = [];

    if (key in serialValueSuggestions) {
      serialValueSuggestions[key as keyof typeof serialValueSuggestions].forEach((value) => {
        options.push({ label: value, type: 'constant' });
      });
    }

    if (['rx_checksum', 'tx_checksum', 'rx_checksum2', 'tx_checksum2'].includes(key)) {
      checksumSuggestions.forEach((value) => {
        options.push({ label: value, type: 'constant' });
      });
    }

    return options;
  };

  const findRangeForPath = (doc: ReturnType<typeof parseDocument>, instancePath: string) => {
    if (!instancePath) return null;
    const segments = instancePath
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    let node: any = doc.contents;

    for (const segment of segments) {
      if (isMap(node)) {
        const match = node.items.find((item: any) =>
          isScalar(item.key) ? item.key.value === segment : false,
        );
        node = match?.value;
      } else if (isSeq(node)) {
        const index = Number(segment);
        node = Number.isFinite(index) ? node.items[index] : undefined;
      } else {
        node = undefined;
      }

      if (!node) return null;
    }

    if (Array.isArray(node.range)) {
      return { from: node.range[0], to: node.range[1] };
    }

    return null;
  };

  const buildCustomDiagnostics = (
    data: Record<string, any> | null,
    doc: ReturnType<typeof parseDocument>,
    text: string,
  ) => {
    const custom: Diagnostic[] = [];

    if (!data || typeof data !== 'object') return custom;

    if (mode === 'bridge') {
      const bridge = data.homenet_bridge;
      if (!bridge || typeof bridge !== 'object') {
        custom.push({
          from: 0,
          to: Math.min(1, text.length),
          severity: 'warning',
          message: $t('editor.yaml_missing_bridge'),
        });
        return custom;
      }

      if (bridge.serial && typeof bridge.serial === 'object' && !bridge.serial.path) {
        const range = findRangeForPath(doc, '/homenet_bridge/serial');
        custom.push({
          from: range?.from ?? 0,
          to: range?.to ?? Math.min(1, text.length),
          severity: 'warning',
          message: $t('editor.yaml_missing_serial_path'),
        });
      }
    }

    return custom;
  };

  const customHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#ff79c6' },
    {
      tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName],
      color: '#8be9fd',
    },
    { tag: [tags.function(tags.variableName), tags.labelName], color: '#50fa7b' },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: '#bd93f9' },
    { tag: [tags.definition(tags.name), tags.separator], color: '#f8f8f2' },
    {
      tag: [
        tags.typeName,
        tags.className,
        tags.number,
        tags.changed,
        tags.annotation,
        tags.modifier,
        tags.self,
        tags.namespace,
      ],
      color: '#bd93f9',
    },
    {
      tag: [
        tags.operator,
        tags.operatorKeyword,
        tags.url,
        tags.escape,
        tags.regexp,
        tags.link,
        tags.special(tags.string),
      ],
      color: '#ff79c6',
    },
    { tag: [tags.meta, tags.comment], color: '#6272a4' },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: '#6272a4', textDecoration: 'underline' },
    { tag: tags.heading, fontWeight: 'bold', color: '#f1fa8c' },
    { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: '#bd93f9' },
    { tag: [tags.processingInstruction, tags.string, tags.inserted], color: '#f1fa8c' },
    { tag: tags.invalid, color: '#ff5555' },
  ]);

  const theme = EditorView.theme(
    {
      '&': {
        height: '100%',
        color: '#f8f8f2',
        backgroundColor: '#282a36',
        borderRadius: '8px',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
        fontSize: '0.85rem',
      },
      '.cm-content': {
        lineHeight: '1.6',
        padding: '1rem',
      },
      '.cm-scroller': {
        overflow: 'auto',
      },
      '.cm-gutters': {
        backgroundColor: '#282a36',
        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
        color: '#6272a4',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(68, 71, 90, 0.4)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'rgba(68, 71, 90, 0.4)',
      },
      '&.cm-focused': {
        outline: 'none',
        borderColor: 'rgba(59, 130, 246, 0.5)',
        boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: '#44475a',
      },
    },
    { dark: true },
  );

  onMount(() => {
    if (!editorHost) return;

    const startState = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        yaml(),
        indentUnit.of('  '),
        highlightActiveLine(),
        lintGutter(),
        yamlLinter,
        autocompletion({ override: [completionSource] }),
        closeBrackets(),
        syntaxHighlighting(customHighlightStyle, { fallback: true }),
        theme,
        editableCompartment.of(EditorView.editable.of(!disabled)),
        placeholderCompartment.of(placeholder(placeholderText ?? '')),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            value = update.state.doc.toString();
          }
        }),
      ],
    });

    view = new EditorView({
      state: startState,
      parent: editorHost,
    });
  });

  $effect(() => {
    if (!view) return;

    const docValue = view.state.doc.toString();
    if (value !== docValue) {
      view.dispatch({
        changes: { from: 0, to: docValue.length, insert: value },
      });
    }
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
    });
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.reconfigure(placeholder(placeholderText ?? '')),
    });
  });

  onDestroy(() => {
    view?.destroy();
  });
</script>

<div
  class={`yaml-editor-wrapper ${className}`}
  aria-label={ariaLabel}
  aria-describedby={ariaDescribedBy}
  aria-busy={disabled}
>
  <div class="yaml-editor" bind:this={editorHost}></div>

  {#if diagnostics.length > 0}
    <div class="yaml-diagnostics" role="status" aria-live="polite">
      <div class="diagnostics-title">{$t('editor.yaml_diagnostics')}</div>
      <ul>
        {#each diagnostics as diagnostic, index (index)}
          <li class={`diagnostic ${diagnostic.severity}`}>
            {diagnostic.message}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .yaml-editor-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    gap: 0.75rem;
  }

  .yaml-editor {
    flex: 1;
    min-height: 320px;
  }

  .yaml-diagnostics {
    padding: 0.75rem 1rem;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #e2e8f0;
    font-size: 0.85rem;
  }

  .diagnostics-title {
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #bae6fd;
  }

  .yaml-diagnostics ul {
    margin: 0;
    padding-left: 1.25rem;
  }

  .diagnostic {
    margin-bottom: 0.35rem;
  }

  .diagnostic.error {
    color: #fca5a5;
  }

  .diagnostic.warning {
    color: #fde68a;
  }

  .diagnostic:last-child {
    margin-bottom: 0;
  }
</style>
