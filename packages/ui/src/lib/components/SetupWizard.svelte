<script lang="ts">
  import { t, locale } from 'svelte-i18n';

  let { configRoot = '', oncomplete }: { configRoot?: string; oncomplete?: () => void } = $props();

  type WizardStep = 'config' | 'consent' | 'complete';

  let examples = $state<string[]>([]);
  let selectedExample = $state('');
  let serialPath = $state('');
  let loading = $state(false);
  let submitting = $state(false);
  let consentSubmitting = $state(false);
  let error = $state('');
  let currentStep = $state<WizardStep>('config');
  let currentLocale = $state('ko');

  // Sync with current locale
  $effect(() => {
    const unsub = locale.subscribe((val) => {
      if (val) currentLocale = val;
    });
    return unsub;
  });

  function toggleLocale() {
    const newLocale = currentLocale === 'ko' ? 'en' : 'ko';
    currentLocale = newLocale;
    locale.set(newLocale);
  }

  // Load examples on mount
  $effect(() => {
    loadExamples();
  });

  async function loadExamples() {
    loading = true;
    error = '';
    try {
      const res = await fetch('./api/config/examples');
      if (!res.ok) throw new Error('Failed to load examples');
      const data = await res.json();
      examples = data.examples || [];
      if (examples.length > 0) {
        selectedExample = examples[0];
      }
      // 사용자가 직접 설정 파일을 지정한 경우 1단계 건너뛰기
      if (data.hasCustomConfig) {
        currentStep = 'consent';
      }
    } catch (err) {
      error = $t('setup_wizard.load_error');
    } finally {
      loading = false;
    }
  }

  async function handleConfigSubmit() {
    if (!selectedExample || !serialPath.trim()) {
      error = $t('setup_wizard.validation_error');
      return;
    }

    submitting = true;
    error = '';

    try {
      const res = await fetch('./api/config/examples/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedExample,
          serialPath: serialPath.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorKey = data.error || 'UNKNOWN_ERROR';
        error = $t(`errors.${errorKey}`, {
          default: data.error || $t('setup_wizard.submit_error'),
        });
        return;
      }

      // 설정 완료 → 로그 동의 단계로 이동
      currentStep = 'consent';
    } catch (err) {
      error = $t('setup_wizard.submit_error');
    } finally {
      submitting = false;
    }
  }

  async function handleConsent(consent: boolean) {
    consentSubmitting = true;
    try {
      await fetch('./api/log-sharing/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      consentSubmitting = false;
      currentStep = 'complete';
      oncomplete?.();
    }
  }

  function getExampleDisplayName(filename: string): string {
    const base = filename.replace(/\.homenet_bridge\.ya?ml$/, '');
    return base.charAt(0).toUpperCase() + base.slice(1).replace(/_/g, ' ');
  }
</script>

<div class="setup-wizard">
  <div class="wizard-card">
    <div class="wizard-header">
      <button class="lang-toggle" onclick={toggleLocale}>
        {currentLocale === 'ko' ? 'EN' : '한국어'}
      </button>
      <h1>{$t('setup_wizard.title')}</h1>
      <p class="subtitle">{$t('setup_wizard.subtitle')}</p>
    </div>

    <!-- Step indicator -->
    <div class="step-indicator">
      <div
        class="step"
        class:active={currentStep === 'config'}
        class:done={currentStep !== 'config'}
      >
        <span class="step-number">1</span>
        <span class="step-label">{$t('setup_wizard.step_config')}</span>
      </div>
      <div class="step-line"></div>
      <div
        class="step"
        class:active={currentStep === 'consent'}
        class:done={currentStep === 'complete'}
      >
        <span class="step-number">2</span>
        <span class="step-label">{$t('setup_wizard.step_consent')}</span>
      </div>
    </div>

    {#if loading}
      <div class="loading-state">
        <p>{$t('setup_wizard.loading')}</p>
      </div>
    {:else if currentStep === 'config'}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          handleConfigSubmit();
        }}
      >
        <div class="form-group">
          <label for="example-select">{$t('setup_wizard.example_label')}</label>
          <select id="example-select" bind:value={selectedExample} disabled={submitting}>
            {#each examples as example}
              <option value={example}>{getExampleDisplayName(example)}</option>
            {/each}
          </select>
          <p class="field-hint">{$t('setup_wizard.example_hint')}</p>
        </div>

        <div class="form-group">
          <label for="serial-path">{$t('setup_wizard.serial_path_label')}</label>
          <input
            type="text"
            id="serial-path"
            bind:value={serialPath}
            placeholder={$t('setup_wizard.serial_path_placeholder')}
            disabled={submitting}
          />
          <p class="field-hint">{$t('setup_wizard.serial_path_hint')}</p>
        </div>

        {#if error}
          <div class="error-message">{error}</div>
        {/if}

        <button
          type="submit"
          class="submit-btn"
          disabled={submitting || !selectedExample || !serialPath.trim()}
        >
          {#if submitting}
            {$t('setup_wizard.submitting')}
          {:else}
            {$t('setup_wizard.next')}
          {/if}
        </button>
      </form>
    {:else if currentStep === 'consent'}
      <div class="consent-section">
        <p class="consent-desc">{$t('settings.log_sharing.consent_modal.desc')}</p>

        <div class="details">
          <h3>{$t('settings.log_sharing.consent_modal.collection_items_title')}</h3>
          <ul>
            <li>{$t('settings.log_sharing.consent_modal.collection_item_1')}</li>
            <li>{$t('settings.log_sharing.consent_modal.collection_item_2')}</li>
            <li>{$t('settings.log_sharing.consent_modal.collection_item_3')}</li>
            <li>{$t('settings.log_sharing.consent_modal.collection_item_4')}</li>
            <li>{$t('settings.log_sharing.consent_modal.collection_item_5')}</li>
          </ul>

          <h3>{$t('settings.log_sharing.consent_modal.collection_timing_title')}</h3>
          <p>{@html $t('settings.log_sharing.consent_modal.collection_timing')}</p>

          <p class="privacy-note">{$t('settings.log_sharing.consent_modal.privacy_note')}</p>
        </div>

        <div class="consent-actions">
          <button
            onclick={() => handleConsent(false)}
            disabled={consentSubmitting}
            class="secondary-btn"
          >
            {$t('settings.log_sharing.consent_modal.decline')}
          </button>
          <button
            onclick={() => handleConsent(true)}
            disabled={consentSubmitting}
            class="submit-btn"
          >
            {$t('settings.log_sharing.consent_modal.accept')}
          </button>
        </div>
      </div>
    {:else if currentStep === 'complete'}
      <div class="success-state">
        <div class="success-icon">✓</div>
        <p class="success-message">{$t('setup_wizard.success_message')}</p>
        <p class="hint">{$t('setup_wizard.restarting')}</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .setup-wizard {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 80vh;
    padding: 2rem;
  }

  .wizard-card {
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 16px;
    padding: 2.5rem;
    max-width: 550px;
    width: 100%;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }

  .wizard-header {
    text-align: center;
    margin-bottom: 1.5rem;
    position: relative;
  }

  .lang-toggle {
    position: absolute;
    top: 0;
    right: 0;
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    background: rgba(148, 163, 184, 0.15);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.2s;
  }

  .lang-toggle:hover {
    background: rgba(148, 163, 184, 0.25);
    color: #f1f5f9;
  }

  .wizard-header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    color: #f1f5f9;
    margin: 0 0 0.5rem 0;
  }

  .subtitle {
    color: #94a3b8;
    font-size: 0.95rem;
    margin: 0;
  }

  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 2rem;
  }

  .step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    opacity: 0.5;
  }

  .step.active {
    opacity: 1;
  }

  .step.done {
    opacity: 0.7;
  }

  .step-number {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .step.active .step-number {
    background: #3b82f6;
    color: white;
  }

  .step.done .step-number {
    background: #10b981;
    color: white;
  }

  .step-label {
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .step.active .step-label {
    color: #f1f5f9;
  }

  .step-line {
    width: 40px;
    height: 2px;
    background: rgba(148, 163, 184, 0.3);
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  label {
    display: block;
    font-size: 0.9rem;
    font-weight: 600;
    color: #e2e8f0;
    margin-bottom: 0.5rem;
  }

  select,
  input {
    width: 100%;
    padding: 0.75rem 1rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.8);
    color: #f1f5f9;
    font-size: 1rem;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
    box-sizing: border-box;
  }

  select:focus,
  input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
  }

  select:disabled,
  input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .field-hint {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0.5rem 0 0 0;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #ef4444;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
  }

  .submit-btn {
    width: 100%;
    padding: 0.875rem 1.5rem;
    border: none;
    border-radius: 8px;
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.2s,
      box-shadow 0.2s;
  }

  .submit-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .secondary-btn {
    padding: 0.875rem 1.5rem;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 8px;
    background: transparent;
    color: #94a3b8;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .secondary-btn:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.1);
    color: #f1f5f9;
  }

  .secondary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .consent-section {
    padding: 0.5rem 0;
  }

  .consent-desc {
    color: #cbd5e1;
    line-height: 1.6;
    margin: 0 0 1rem 0;
  }

  .details {
    font-size: 0.9rem;
    color: #94a3b8;
    background: rgba(15, 23, 42, 0.5);
    padding: 1.25rem;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .details h3 {
    margin: 0 0 0.75rem 0;
    color: #e2e8f0;
    font-size: 0.95rem;
  }

  .details ul {
    margin: 0 0 1.25rem 0;
    padding-left: 1.25rem;
  }

  .details li {
    margin-bottom: 0.4rem;
  }

  .details p {
    margin: 0 0 0.5rem 0;
    line-height: 1.5;
  }

  .privacy-note {
    font-size: 0.8rem;
    color: #64748b;
    margin-top: 1rem !important;
  }

  .consent-actions {
    display: flex;
    gap: 1rem;
  }

  .consent-actions .submit-btn {
    flex: 1;
  }

  .loading-state,
  .success-state {
    text-align: center;
    padding: 2rem 0;
  }

  .loading-state p {
    color: #94a3b8;
    margin: 0;
  }

  .success-icon {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    font-size: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 1rem;
  }

  .success-message {
    color: #10b981;
    font-weight: 600;
    font-size: 1.1rem;
    margin: 0 0 0.5rem 0;
  }

  .hint {
    color: #94a3b8;
    font-style: italic;
    font-size: 0.9rem;
    margin: 0;
  }

  @media (max-width: 600px) {
    .wizard-card {
      padding: 1.5rem;
    }

    .wizard-header h1 {
      font-size: 1.5rem;
    }

    .step-label {
      display: none;
    }

    .consent-actions {
      flex-direction: column;
    }
  }
</style>
