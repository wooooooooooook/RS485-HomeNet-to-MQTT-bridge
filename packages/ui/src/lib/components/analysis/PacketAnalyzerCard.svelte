<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { PacketAnalysisResult } from '../../types';
  import Button from '../Button.svelte';

  let { portIds, activePortId } = $props<{
    portIds: string[];
    activePortId: string | null;
  }>();

  let packetInput = $state('');
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let result = $state<PacketAnalysisResult | null>(null);

  const formatState = (state: unknown) => {
    try {
      return JSON.stringify(state, null, 2);
    } catch {
      return String(state);
    }
  };

  const splitToBytes = (hex: string) => {
    const raw = hex.replace(/\s+/g, '');
    const bytes: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      bytes.push(raw.slice(i, i + 2));
    }
    return bytes;
  };

  const handleAnalyze = async () => {
    error = null;
    result = null;

    if (!packetInput.trim()) {
      error = $t('analysis.packet_analyzer.input_required');
      return;
    }

    isLoading = true;

    try {
      const targetPortId = activePortId ?? portIds[0] ?? '';
      const response = await fetch('./api/tools/packet/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: packetInput, portId: targetPortId || undefined }),
      });
      const payload = await response.json();
      if (!response.ok) {
        error = payload?.error ?? $t('analysis.packet_analyzer.request_failed');
        return;
      }
      result = payload as PacketAnalysisResult;
    } catch (err) {
      error = err instanceof Error ? err.message : $t('analysis.packet_analyzer.request_failed');
    } finally {
      isLoading = false;
    }
  };

  // --- YAML Preview Toggle Support ---
  let expandedEntityId = $state<string | null>(null);
  let isYamlLoading = $state(false);
  let yamlCache = new Map<string, string>();

  const fetchEntityYaml = async (id: string, category: 'entity' | 'automation' | 'script') => {
    // Toggle off if same id clicked
    if (expandedEntityId === id) {
      expandedEntityId = null;
      return;
    }

    // Set active id immediately for UI feedback
    expandedEntityId = id;

    if (yamlCache.has(id)) {
      return;
    }

    isYamlLoading = true;
    try {
      const res = await fetch(`./api/config/raw/${category}/${id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      yamlCache.set(id, data.yaml);
    } catch {
      yamlCache.set(id, 'Failed to load configuration');
    } finally {
      isYamlLoading = false;
    }
  };
</script>

<div class="analysis-card">
  <div class="card-header">
    <div>
      <h2>{$t('analysis.packet_analyzer.title')}</h2>
      <p class="description">{$t('analysis.packet_analyzer.desc')}</p>
    </div>
  </div>

  <div class="card-body">
    <div class="format-hint">
      <span class="label">{$t('analysis.packet_analyzer.format_label')}</span>
      <span class="inline-hint">{$t('analysis.packet_analyzer.format_hint')}</span>
    </div>

    <div class="form-row full">
      <label>
        <span class="label">{$t('analysis.packet_analyzer.input_label')}</span>
        <textarea
          rows="4"
          bind:value={packetInput}
          placeholder={$t('analysis.packet_analyzer.input_placeholder')}
        ></textarea>
      </label>
      <p class="hint">{$t('analysis.packet_analyzer.input_hint')}</p>
    </div>

    <div class="action-row">
      <Button variant="outline-primary" onclick={handleAnalyze} disabled={isLoading} {isLoading}>
        {$t('analysis.packet_analyzer.run')}
      </Button>
      <span class="help-text">{$t('analysis.packet_analyzer.note')}</span>
    </div>

    {#if error}
      <div class="message error">{error}</div>
    {/if}

    {#if result}
      <div class="result">
        <div class="result-header">
          {$t('analysis.packet_analyzer.valid_packets', {
            values: { count: result.packets.length },
          })}
        </div>
        {#if result.packets.length === 0}
          <p class="empty">{$t('analysis.packet_analyzer.empty')}</p>
        {:else}
          <div class="packet-list">
            {#each result.packets as packet, index}
              {@const bytes = splitToBytes(packet.hex)}
              <div class="packet-card">
                <div class="packet-title">
                  <span
                    >{$t('analysis.packet_analyzer.packet_label', {
                      values: { index: index + 1 },
                    })}</span
                  >
                  <div class="packet-hex-container">
                    <div class="hex-row">
                      {#each bytes as byte}
                        <span class="byte">{byte}</span>
                      {/each}
                    </div>
                    <div class="offset-row">
                      {#each bytes as _, i}
                        <span class="offset">{i}</span>
                      {/each}
                    </div>
                  </div>
                </div>
                <div class="packet-section">
                  <div class="section-title">
                    {$t('analysis.packet_analyzer.entity_match_title')}
                  </div>
                  {#if packet.matches.length === 0}
                    <p class="empty">{$t('analysis.packet_analyzer.entity_match_empty')}</p>
                  {:else}
                    <ul>
                      {#each packet.matches as match}
                        <li>
                          <button
                            class="entity-preview-btn"
                            class:active={expandedEntityId === match.entityId}
                            onclick={() => fetchEntityYaml(match.entityId, 'entity')}
                            aria-expanded={expandedEntityId === match.entityId}
                            title={$t('analysis.packet_analyzer.toggle_yaml_preview')}
                          >
                            <strong>{match.entityName}</strong>
                          </button>
                          <span class="muted">({match.entityType} · {match.entityId})</span>

                          {#if expandedEntityId === match.entityId}
                            <div class="yaml-preview-block">
                              {#if isYamlLoading && !yamlCache.has(match.entityId)}
                                <div class="loading-inline">
                                  <span class="loading-spinner"></span>
                                  <span>Loading...</span>
                                </div>
                              {:else}
                                <pre class="yaml-code"><code>{yamlCache.get(match.entityId)}</code
                                  ></pre>
                              {/if}
                            </div>
                          {/if}

                          <pre>{formatState(match.state)}</pre>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div class="result-header">
          {$t('analysis.packet_analyzer.unmatched_packets', {
            values: { count: result.unmatchedPackets.length },
          })}
        </div>
        {#if result.unmatchedPackets.length === 0}
          <p class="empty">{$t('analysis.packet_analyzer.unmatched_empty')}</p>
        {:else}
          <ul class="compact-list">
            {#each result.unmatchedPackets as packet, index}
              {@const bytes = splitToBytes(packet.hex)}
              <li>
                <span
                  >{$t('analysis.packet_analyzer.packet_label', {
                    values: { index: index + 1 },
                  })}</span
                >
                <div class="packet-hex-container compact">
                  <div class="hex-row">
                    {#each bytes as byte}
                      <span class="byte">{byte}</span>
                    {/each}
                  </div>
                  <div class="offset-row">
                    {#each bytes as _, i}
                      <span class="offset">{i}</span>
                    {/each}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="result-header">
          {$t('analysis.packet_analyzer.automation_title', {
            values: { count: result.automationMatches.length },
          })}
        </div>
        {#if result.automationMatches.length === 0}
          <p class="empty">{$t('analysis.packet_analyzer.automation_empty')}</p>
        {:else}
          <ul class="automation-list">
            {#each result.automationMatches as match}
              <li>
                <div class="automation-title">
                  <button
                    class="entity-preview-btn"
                    class:active={expandedEntityId === match.automationId}
                    onclick={() => fetchEntityYaml(match.automationId, 'automation')}
                    aria-expanded={expandedEntityId === match.automationId}
                    title={$t('analysis.packet_analyzer.toggle_yaml_preview')}
                  >
                    <strong>{match.name || match.automationId}</strong>
                  </button>
                  <span class="muted">({match.automationId})</span>
                </div>

                {#if expandedEntityId === match.automationId}
                  <div class="yaml-preview-block">
                    {#if isYamlLoading && !yamlCache.has(match.automationId)}
                      <div class="loading-inline">
                        <span class="loading-spinner"></span>
                        <span>Loading...</span>
                      </div>
                    {:else}
                      <pre class="yaml-code"><code>{yamlCache.get(match.automationId)}</code></pre>
                    {/if}
                  </div>
                {/if}
                <div class="automation-meta">
                  <span class="badge">{match.triggerType}</span>
                  <span class="badge"
                    >{$t('analysis.packet_analyzer.trigger_label', {
                      values: { index: match.triggerIndex + 1 },
                    })}</span
                  >
                  <span class="badge"
                    >{$t('analysis.packet_analyzer.packet_ref', {
                      values: { index: match.packetIndex + 1 },
                    })}</span
                  >
                </div>
                {#if match.entityId}
                  <div class="automation-detail">
                    {$t('analysis.packet_analyzer.state_match', {
                      values: {
                        entityId: match.entityId,
                        property: match.property ?? '-',
                      },
                    })}
                  </div>
                {/if}
                {#if match.matchedValue !== undefined}
                  <pre>{formatState(match.matchedValue)}</pre>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if result.errors.length > 0}
          <div class="result-header">{$t('analysis.packet_analyzer.errors_title')}</div>
          <ul class="compact-list">
            {#each result.errors as err}
              <li>{err}</li>
            {/each}
          </ul>
        {/if}
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
    min-height: 110px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: #cbd5e1;
    font-size: 0.85rem;
  }

  textarea {
    padding: 0.6rem 0.75rem;
    background: rgba(15, 23, 42, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 10px;
    color: #e2e8f0;
    font-size: 0.9rem;
  }

  .hint,
  .help-text,
  .inline-hint {
    color: #94a3b8;
    font-size: 0.8rem;
  }

  .inline-hint {
    display: block;
    margin-top: 0.35rem;
  }

  .format-hint {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  .message.error {
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.4);
    color: #fecaca;
    padding: 0.75rem 1rem;
    border-radius: 10px;
  }

  .result {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .result-header {
    color: #e2e8f0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .packet-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .packet-card {
    background: rgba(30, 41, 59, 0.4);
    border-radius: 12px;
    padding: 0.9rem;
    border: 1px solid rgba(148, 163, 184, 0.1);
  }

  .packet-title {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-weight: 600;
    color: #e2e8f0;
  }

  .packet-hex-container {
    background: rgba(15, 23, 42, 0.4);
    padding: 0.75rem;
    border-radius: 8px;
    font-family: 'Fira Code', monospace;
    overflow-x: auto;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.5rem;
  }

  .packet-hex-container.compact {
    flex: 1;
    margin-top: 0;
    padding: 0.5rem;
  }

  .hex-row,
  .offset-row {
    display: flex;
    gap: 0.4rem;
    min-width: max-content;
  }

  .byte,
  .offset {
    width: 1.6rem;
    text-align: center;
    flex-shrink: 0;
  }

  .byte {
    color: #7dd3fc;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .offset {
    color: #64748b;
    font-size: 0.7rem;
  }

  .badge {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    background: rgba(59, 130, 246, 0.15);
    color: #bae6fd;
    border-radius: 999px;
    font-size: 0.75rem;
    margin-right: 0.4rem;
  }

  .packet-section {
    margin-top: 0.8rem;
  }

  .section-title {
    font-size: 0.85rem;
    color: #cbd5e1;
    margin-bottom: 0.5rem;
  }

  ul {
    margin: 0;
    padding-left: 1.2rem;
  }

  li {
    margin-bottom: 0.6rem;
  }

  pre {
    background: rgba(15, 23, 42, 0.75);
    color: #e2e8f0;
    padding: 0.6rem;
    border-radius: 8px;
    font-size: 0.8rem;
    overflow-x: auto;
    margin-top: 0.4rem;
  }

  .muted {
    color: #94a3b8;
    font-size: 0.75rem;
    margin-left: 0.3rem;
  }

  .compact-list {
    list-style: none;
    padding-left: 0;
    margin: 0;
  }

  .compact-list li {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .automation-list {
    list-style: none;
    padding-left: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .automation-title {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .automation-meta {
    margin-top: 0.3rem;
  }

  .automation-detail {
    margin-top: 0.4rem;
    color: #cbd5e1;
    font-size: 0.8rem;
  }

  .empty {
    color: #94a3b8;
    font-size: 0.85rem;
    margin: 0.25rem 0 0;
  }

  /* YAML Preview Styles */
  .entity-preview-btn {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
    display: inline-flex;
    align-items: center;
    border-bottom: 1px dashed rgba(148, 163, 184, 0.4);
    transition: all 0.2s;
  }

  .entity-preview-btn:hover,
  .entity-preview-btn.active {
    color: #7dd3fc;
    border-bottom-color: #7dd3fc;
  }

  .yaml-preview-block {
    margin: 0.5rem 0;
    background: #0f172a;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    overflow: hidden;
    animation: slideDown 0.2s ease-out;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-5px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .yaml-code {
    margin: 0;
    padding: 0.75rem;
    background: rgba(15, 23, 42, 0.8);
    font-size: 0.8rem;
    max-height: 400px;
    overflow-y: auto;
    border: none;
  }

  .loading-inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .loading-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(148, 163, 184, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
