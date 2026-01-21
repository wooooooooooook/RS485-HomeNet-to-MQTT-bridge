<script lang="ts">
  import { t } from 'svelte-i18n';

  type ModeValue = 'state' | 'command' | 'automation' | 'checksum';
  type AnalyzerStateOption = {
    id: string;
    label: string;
    state: Record<string, unknown>;
    portId?: string;
  };

  const modes: { value: ModeValue; label: string; hint: string }[] = [
    {
      value: 'state',
      label: 'analysis.cel_analyzer.mode_state',
      hint: 'analysis.cel_analyzer.mode_state_hint',
    },
    {
      value: 'command',
      label: 'analysis.cel_analyzer.mode_command',
      hint: 'analysis.cel_analyzer.mode_command_hint',
    },
    {
      value: 'automation',
      label: 'analysis.cel_analyzer.mode_automation',
      hint: 'analysis.cel_analyzer.mode_automation_hint',
    },
    {
      value: 'checksum',
      label: 'analysis.cel_analyzer.mode_checksum',
      hint: 'analysis.cel_analyzer.mode_checksum_hint',
    },
  ];

  let { statesSnapshot, stateOptions } = $props<{
    statesSnapshot: Record<string, Record<string, unknown>>;
    stateOptions: AnalyzerStateOption[];
  }>();

  let mode = $state<ModeValue>('state');
  let expression = $state('');
  let dataInput = $state('');
  let xInput = $state('');
  let xstrInput = $state('');
  let stateInput = $state('');
  let statesInput = $state('');
  let triggerInput = $state('');
  let selectedStateId = $state('');
  let result = $state<string | null>(null);
  let error = $state<string | null>(null);
  let isLoading = $state(false);

  const hasStateOptions = $derived.by(() => stateOptions.length > 0);
  const hasStatesSnapshot = $derived.by(() => Object.keys(statesSnapshot).length > 0);

  $effect(() => {
    if (!selectedStateId) return;
    if (!stateOptions.some((option: AnalyzerStateOption) => option.id === selectedStateId)) {
      selectedStateId = '';
    }
  });

  const formatResult = (value: unknown) => {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const normalizeSingleQuoteJson = (input: string) =>
    input.replace(/'(?:\\.|[^'\\])*'/g, (match) => {
      const inner = match.slice(1, -1);
      const escaped = inner.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${escaped}"`;
    });

  const parseJsonValue = (input: string) => {
    try {
      return JSON.parse(input);
    } catch {
      const normalized = normalizeSingleQuoteJson(input);
      return JSON.parse(normalized);
    }
  };

  const parseJsonInput = (input: string, label: string) => {
    if (!input.trim()) return undefined;
    try {
      return parseJsonValue(input);
    } catch {
      throw new Error(`${label} ${$t('analysis.cel_analyzer.invalid_json')}`);
    }
  };

  const parseDataInput = (input: string) => {
    if (!input.trim()) return undefined;
    try {
      const jsonValue = parseJsonValue(input);
      if (!Array.isArray(jsonValue)) {
        throw new Error($t('analysis.cel_analyzer.must_be_array'));
      }
      return jsonValue;
    } catch {
      const trimmed = input.trim();
      if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
        throw new Error(
          `${$t('analysis.cel_analyzer.data_label')} ${$t('analysis.cel_analyzer.invalid_json')}`,
        );
      }
      const body = trimmed.slice(1, -1).trim();
      if (!body) return [];
      const tokens = body.split(',').map((token) => token.trim());
      const values = tokens.map((token) => {
        if (!token) return NaN;
        if (/^0x[0-9a-fA-F]+$/.test(token)) {
          return Number.parseInt(token, 16);
        }
        return Number(token);
      });
      if (values.some((value) => Number.isNaN(value))) {
        throw new Error($t('analysis.cel_analyzer.invalid_number_array'));
      }
      return values;
    }
  };

  const parseObjectInput = (input: string, label: string) => {
    const value = parseJsonInput(input, label);
    if (value === undefined) return undefined;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} ${$t('analysis.cel_analyzer.must_be_object')}`);
    }
    return value;
  };

  const parseArrayInput = (input: string, label: string) => {
    const value = parseJsonInput(input, label);
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      throw new Error(`${label} ${$t('analysis.cel_analyzer.must_be_array')}`);
    }
    return value;
  };

  const parseXInput = () => {
    if (xstrInput.trim()) {
      return xstrInput.trim();
    }
    if (!xInput.trim()) return undefined;
    const value = Number(xInput);
    if (Number.isNaN(value)) {
      throw new Error($t('analysis.cel_analyzer.invalid_number'));
    }
    return value;
  };

  const handleLoadStates = () => {
    error = null;
    if (!hasStatesSnapshot) return;
    statesInput = JSON.stringify(statesSnapshot, null, 2);
  };

  const handleLoadState = () => {
    error = null;
    const target = stateOptions.find((option: AnalyzerStateOption) => option.id === selectedStateId);
    if (!target) return;
    stateInput = JSON.stringify(target.state, null, 2);
  };

  const handleEvaluate = async () => {
    error = null;
    result = null;

    if (!expression.trim()) {
      error = $t('analysis.cel_analyzer.expression_required');
      return;
    }

    try {
      const context: Record<string, unknown> = {};
      const xValue = parseXInput();
      if (xValue !== undefined) context.x = xValue;

      const dataValue = parseDataInput(dataInput);
      if (dataValue !== undefined) context.data = dataValue;

      const stateValue = parseObjectInput(stateInput, $t('analysis.cel_analyzer.state_label'));
      if (stateValue !== undefined) context.state = stateValue;

      const statesValue = parseObjectInput(statesInput, $t('analysis.cel_analyzer.states_label'));
      if (statesValue !== undefined) context.states = statesValue;

      const triggerValue = parseObjectInput(
        triggerInput,
        $t('analysis.cel_analyzer.trigger_label'),
      );
      if (triggerValue !== undefined) context.trigger = triggerValue;

      isLoading = true;
      const response = await fetch('./api/cel/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: expression, context }),
      });
      const payload = await response.json();
      if (!response.ok) {
        error = payload?.error ?? $t('analysis.cel_analyzer.request_failed');
        return;
      }
      if (payload?.error) {
        error = payload.error;
      }
      result = formatResult(payload?.result);
    } catch (err) {
      error = err instanceof Error ? err.message : $t('analysis.cel_analyzer.request_failed');
    } finally {
      isLoading = false;
    }
  };
</script>

<div class="analysis-card">
  <div class="card-header">
    <div>
      <h2>{$t('analysis.cel_analyzer.title')}</h2>
      <p class="description">{$t('analysis.cel_analyzer.desc')}</p>
    </div>
  </div>

  <div class="card-body">
    <div class="form-row">
      <label>
        <span class="label">{$t('analysis.cel_analyzer.mode_label')}</span>
        <select bind:value={mode}>
          {#each modes as option (option.value)}
            <option value={option.value}>{$t(option.label)}</option>
          {/each}
        </select>
      </label>
      <p class="hint">
        {$t(modes.find((option) => option.value === mode)?.hint ?? modes[0].hint)}
      </p>
    </div>

    <div class="form-row full">
      <label>
        <span class="label">{$t('analysis.cel_analyzer.expression_label')}</span>
        <textarea
          rows="3"
          bind:value={expression}
          placeholder={$t('analysis.cel_analyzer.expression_placeholder')}
        ></textarea>
      </label>
    </div>

    <div class="grid">
      <label>
        <span class="label">{$t('analysis.cel_analyzer.x_label')}</span>
        <input
          type="text"
          inputmode="decimal"
          bind:value={xInput}
          placeholder={$t('analysis.cel_analyzer.x_placeholder')}
        />
      </label>
      <label>
        <span class="label">{$t('analysis.cel_analyzer.xstr_label')}</span>
        <input
          type="text"
          bind:value={xstrInput}
          placeholder={$t('analysis.cel_analyzer.xstr_placeholder')}
        />
      </label>
    </div>

    <div class="grid">
      <label>
        <span class="label">{$t('analysis.cel_analyzer.data_label')}</span>
        <textarea
          rows="2"
          bind:value={dataInput}
          placeholder={$t('analysis.cel_analyzer.data_placeholder')}
        ></textarea>
        <span class="inline-hint">{$t('analysis.cel_analyzer.data_hint')}</span>
      </label>
      <label>
        <span class="label">{$t('analysis.cel_analyzer.state_label')}</span>
        <textarea
          rows="2"
          bind:value={stateInput}
          placeholder={$t('analysis.cel_analyzer.state_placeholder')}
        ></textarea>
        <div class="inline-actions">
          <select bind:value={selectedStateId} disabled={!hasStateOptions}>
            <option value="" disabled>{$t('analysis.cel_analyzer.state_select_placeholder')}</option>
            {#each stateOptions as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
          <button
            type="button"
            class="ghost"
            onclick={handleLoadState}
            disabled={!selectedStateId}
          >
            {$t('analysis.cel_analyzer.state_fetch')}
          </button>
        </div>
      </label>
      <label>
        <span class="label">{$t('analysis.cel_analyzer.states_label')}</span>
        <textarea
          rows="2"
          bind:value={statesInput}
          placeholder={$t('analysis.cel_analyzer.states_placeholder')}
        ></textarea>
        <button
          type="button"
          class="ghost"
          onclick={handleLoadStates}
          disabled={!hasStatesSnapshot}
        >
          {$t('analysis.cel_analyzer.states_fetch')}
        </button>
      </label>
      <label>
        <span class="label">{$t('analysis.cel_analyzer.trigger_label')}</span>
        <textarea
          rows="2"
          bind:value={triggerInput}
          placeholder={$t('analysis.cel_analyzer.trigger_placeholder')}
        ></textarea>
      </label>
    </div>

    <div class="action-row">
      <button type="button" class="primary" onclick={handleEvaluate} disabled={isLoading}>
        {#if isLoading}
          {$t('analysis.cel_analyzer.running')}
        {:else}
          {$t('analysis.cel_analyzer.run')}
        {/if}
      </button>
      <span class="help-text">{$t('analysis.cel_analyzer.json_help')}</span>
    </div>

    {#if error}
      <div class="message error">{error}</div>
    {/if}

    {#if result !== null}
      <div class="result">
        <div class="result-header">{$t('analysis.cel_analyzer.result_label')}</div>
        <pre>{result}</pre>
        <p class="result-hint">{$t('analysis.cel_analyzer.result_hint')}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .analysis-card {
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1.5rem;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.1rem;
    margin: 0 0 0.35rem 0;
    color: #e2e8f0;
  }

  .description {
    color: #94a3b8;
    font-size: 0.9rem;
    margin: 0;
  }

  .card-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .form-row.full textarea {
    min-height: 90px;
  }

  .grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: #cbd5e1;
    font-size: 0.85rem;
  }

  select,
  input,
  textarea {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
    color: #e2e8f0;
    font-family: inherit;
    font-size: 0.9rem;
  }

  textarea {
    font-family: 'Fira Code', 'Consolas', monospace;
    resize: vertical;
  }

  .label {
    font-weight: 600;
  }

  .hint {
    color: #94a3b8;
    font-size: 0.85rem;
    margin: 0;
  }

  .inline-hint {
    color: #64748b;
    font-size: 0.78rem;
  }

  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
  }

  .ghost {
    padding: 0.4rem 0.7rem;
    border-radius: 6px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: transparent;
    color: #cbd5e1;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    padding: 0.5rem 1rem;
    border-radius: 8px;
    border: 1px solid rgba(59, 130, 246, 0.6);
    background: rgba(59, 130, 246, 0.2);
    color: #bfdbfe;
    cursor: pointer;
    font-weight: 600;
  }

  .primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .help-text {
    color: #94a3b8;
    font-size: 0.85rem;
  }

  .message {
    padding: 0.75rem 1rem;
    border-radius: 8px;
    font-size: 0.9rem;
  }

  .message.error {
    background: rgba(248, 113, 113, 0.15);
    border: 1px solid rgba(248, 113, 113, 0.4);
    color: #fecaca;
  }

  .result {
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 10px;
    padding: 1rem;
  }

  .result-header {
    color: #e2e8f0;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .result pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: #10b981;
    font-size: 0.9rem;
  }

  .result-hint {
    margin: 0.75rem 0 0;
    color: #94a3b8;
    font-size: 0.8rem;
  }

  @media (max-width: 480px) {
    .analysis-card {
      padding: 1rem;
    }
  }
</style>
