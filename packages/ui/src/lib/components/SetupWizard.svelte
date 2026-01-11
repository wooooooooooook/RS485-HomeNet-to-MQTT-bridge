<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';
  import Modal from './Modal.svelte';

  let {
    configRoot = '',
    oncomplete,
    onclose,
    mode = 'init',
  }: {
    configRoot?: string;
    oncomplete?: () => void;
    onclose?: () => void;
    mode?: 'init' | 'add';
  } = $props();

  type WizardStep = 'config' | 'packet_defaults' | 'entity_selection' | 'consent' | 'complete';

  // ... (rest of simple variable declarations unchanged)
  // To avoid huge diff, I will target the script block first to add props and import.
  // Then I will target the template to use snippet.

  const EMPTY_CONFIG_VALUE = '__empty__';
  const DEFAULT_PACKET_DEFAULTS = {
    rx_timeout: '10ms',
    tx_timeout: '100ms',
    tx_delay: '50ms',
    tx_retry_cnt: 3,
  };
  let examples = $state<string[]>([]);
  let selectedExample = $state('');
  let serialPath = $state('');
  let serialPortId = $state('main');
  let serialBaudRate = $state('9600');
  let serialDataBits = $state('8');
  let serialParity = $state('none');
  let serialStopBits = $state('1');
  let loading = $state(false);
  let submitting = $state(false);
  let consentSubmitting = $state(false);
  let error = $state('');
  let testingSerial = $state(false);
  let testError = $state('');
  let testPackets = $state<string[]>([]);
  let hasTested = $state(false);
  let currentStep = $state<WizardStep>('config');
  let currentLocale = $state('ko');
  let requiresManualUpdate = $state(false);
  let createdFilename = $state('');

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

  // Reset test result when input changes
  $effect(() => {
    serialPath;
    selectedExample;
    serialPortId;
    serialBaudRate;
    serialDataBits;
    serialParity;
    serialStopBits;
    testError = '';
    testPackets = [];
    hasTested = false;
  });

  // Example serial config info
  type ExampleSerialInfo = {
    portId?: string;
    baud_rate?: number;
    data_bits?: number;
    parity?: string;
    stop_bits?: number;
  };
  let exampleSerialInfo = $state<ExampleSerialInfo | null>(null);
  let exampleSerialLoading = $state(false);
  let packetDefaults = $state<Record<string, any>>({ ...DEFAULT_PACKET_DEFAULTS });

  let entities = $state<Record<string, { id: string; name: string }[]>>({});
  let selectedEntities = $state<Record<string, string[]>>({});
  let loadingEntities = $state(false);

  // Fetch example serial config when example changes
  $effect(() => {
    const example = selectedExample;
    if (!example || example === EMPTY_CONFIG_VALUE) {
      exampleSerialInfo = null;
      packetDefaults = { ...DEFAULT_PACKET_DEFAULTS };
      if (example === EMPTY_CONFIG_VALUE) {
        serialPortId = 'custom_port';
      }
      return;
    }

    exampleSerialLoading = true;
    exampleSerialInfo = null;

    fetch(`./api/config/examples/${encodeURIComponent(example)}/serial`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch serial info');
        return res.json();
      })
      .then((data) => {
        if (data.ok && data.serial) {
          exampleSerialInfo = data.serial;
          if (data.serial.portId) {
            serialPortId = data.serial.portId;
          }
          if (data.packetDefaults) {
            packetDefaults = { ...data.packetDefaults };
          } else {
            packetDefaults = { ...DEFAULT_PACKET_DEFAULTS };
          }
        }
      })
      .catch(() => {
        exampleSerialInfo = null;
        packetDefaults = { ...DEFAULT_PACKET_DEFAULTS };
      })
      .finally(() => {
        exampleSerialLoading = false;
      });
  });

  async function loadExamples() {
    loading = true;
    error = '';
    try {
      // 예제 목록과 로그 동의 상태를 동시에 확인
      const [configRes, consentRes] = await Promise.all([
        fetch('./api/config/examples'),
        fetch('./api/log-sharing/status'),
      ]);

      if (!configRes.ok) throw new Error('Failed to load examples');
      const data = await configRes.json();
      examples = data.examples || [];
      if (examples.length > 0) {
        selectedExample = examples[0];
      } else {
        selectedExample = EMPTY_CONFIG_VALUE;
      }

      if (mode === 'add') return;

      // 로그 동의가 이미 완료된 경우 바로 complete 화면으로
      if (consentRes.ok) {
        const consentStatus = await consentRes.json();
        if (consentStatus.asked) {
          currentStep = 'complete';
          loading = false;
          return;
        }
      }

      // 초기화가 이미 끝났거나 사용자가 직접 설정 파일을 지정한 경우에만 1단계 건너뛰기
      if (!data.requiresInitialization && data.hasCustomConfig) {
        currentStep = 'consent';
      }
    } catch (err) {
      error = $t('setup_wizard.load_error');
    } finally {
      loading = false;
    }
  }

  function parseConfigValue(val: any): any {
    if (typeof val !== 'string') return val;
    val = val.trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      try {
        return JSON.parse(val);
      } catch {
        const inner = val.slice(1, -1);
        if (!inner) return [];
        return inner.split(',').map((v: string) => {
          v = v.trim();
          if (/^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16);
          const n = Number(v);
          return isNaN(n) ? v : n;
        });
      }
    }
    return val;
  }

  async function handleConfigSubmit() {
    if (currentStep === 'config') {
      const serialConfigPayload = buildSerialConfigPayload();
      if (!selectedExample || !serialConfigPayload) {
        error = $t('setup_wizard.validation_error');
        return;
      }
      if (mode === 'add') {
        try {
          const res = await fetch('./api/config/check-duplicate-serial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serialPath: serialPath.trim(),
              portId: serialPortId.trim(),
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            error = $t(`errors.${data.error || 'UNKNOWN_ERROR'}`);
            return;
          }
        } catch (e) {
          console.error(e);
          error = $t('errors.UNKNOWN_ERROR');
          return;
        }
      }

      if (!hasTested) {
        await handleSerialTest();
        if (testPackets.length === 0) {
          error = $t('setup_wizard.serial_test_failed_warning');
          return;
        }
      }

      currentStep = 'packet_defaults';
      error = '';
      return;
    }

    if (currentStep === 'packet_defaults') {
      await loadEntities();
      currentStep = 'entity_selection';
      return;
    }

    if (currentStep === 'entity_selection') {
      const serialConfigPayload = buildSerialConfigPayload();
      submitting = true;
      error = '';

      const finalPacketDefaults = { ...packetDefaults };
      ['rx_header', 'rx_footer', 'tx_header', 'tx_footer'].forEach((key) => {
        if (typeof finalPacketDefaults[key] === 'string') {
          finalPacketDefaults[key] = parseConfigValue(finalPacketDefaults[key]);
        }
      });

      try {
        const res = await fetch('./api/config/examples/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            selectedExample === EMPTY_CONFIG_VALUE
              ? {
                  filename: EMPTY_CONFIG_VALUE,
                  serialConfig: serialConfigPayload,
                  packetDefaults: finalPacketDefaults,
                  selectedEntities,
                  mode,
                }
              : {
                  filename: selectedExample,
                  serialPath: serialPath.trim(),
                  portId: serialPortId.trim(),
                  packetDefaults: finalPacketDefaults,
                  selectedEntities,
                  mode,
                },
          ),
        });

        const data = await res.json();

        if (!res.ok) {
          const errorKey = data.error || 'UNKNOWN_ERROR';
          error = $t(`errors.${errorKey}`, {
            default: data.error || $t('setup_wizard.submit_error'),
          });
          return;
        }

        if (mode === 'add') {
          currentStep = 'complete';
          requiresManualUpdate = data.requiresManualConfigUpdate;
          createdFilename = data.target;
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
  }

  async function loadEntities() {
    if (!selectedExample || selectedExample === EMPTY_CONFIG_VALUE) {
      entities = {};
      selectedEntities = {};
      return;
    }

    loadingEntities = true;
    try {
      const res = await fetch(
        `./api/config/examples/${encodeURIComponent(selectedExample)}/entities`,
      );
      if (!res.ok) throw new Error('Failed to fetch entities');
      const data = await res.json();
      entities = data.entities || {};

      // Default select all
      const initialSelection: Record<string, string[]> = {};
      for (const [type, items] of Object.entries(entities)) {
        initialSelection[type] = items.map((i) => i.id);
      }
      selectedEntities = initialSelection;
    } catch (err) {
      console.error(err);
      entities = {};
    } finally {
      loadingEntities = false;
    }
  }

  function toggleType(type: string, checked: boolean) {
    if (checked) {
      selectedEntities[type] = entities[type]?.map((i) => i.id) || [];
    } else {
      selectedEntities[type] = [];
    }
  }

  function toggleEntity(type: string, id: string, checked: boolean) {
    const current = selectedEntities[type] || [];
    if (checked) {
      if (!current.includes(id)) {
        selectedEntities[type] = [...current, id];
      }
    } else {
      selectedEntities[type] = current.filter((i) => i !== id);
    }
  }

  function handlePrevious() {
    if (currentStep === 'packet_defaults') {
      currentStep = 'config';
    } else if (currentStep === 'entity_selection') {
      currentStep = 'packet_defaults';
    } else if (currentStep === 'consent') {
      currentStep = 'entity_selection';
    }
  }

  async function handleSerialTest() {
    const serialConfigPayload = buildSerialConfigPayload();
    if (!selectedExample || !serialConfigPayload) {
      testError = $t('setup_wizard.validation_error');
      return;
    }

    testingSerial = true;
    testError = '';
    hasTested = true;
    testPackets = [];

    try {
      const res = await fetch('./api/config/examples/test-serial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          selectedExample === EMPTY_CONFIG_VALUE
            ? {
                filename: EMPTY_CONFIG_VALUE,
                serialConfig: serialConfigPayload,
              }
            : {
                filename: selectedExample,
                serialPath: serialPath.trim(),
                portId: serialPortId.trim(),
              },
        ),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorKey = data.error || 'UNKNOWN_ERROR';
        if (errorKey === 'SERIAL_TEST_FAILED') {
          // If detailed error message is available, show it
          error = $t('setup_wizard.serial_test_failed_warning');
          if (data.details) {
            error += ` (${data.details})`;
          }
        } else {
          error = $t(`errors.${errorKey}`, {
            default: data.error || $t('setup_wizard.serial_test_error'),
          });
          if (data.details) {
            error += ` (${data.details})`;
          }
        }
        return;
      }

      testPackets = Array.isArray(data.packets) ? data.packets : [];

      if (testPackets.length === 0) {
        error = $t('setup_wizard.serial_test_empty');
      }
    } catch (err) {
      error = $t('setup_wizard.serial_test_error');
    } finally {
      testingSerial = false;
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
      // oncomplete은 호출하지 않음 - complete 화면에서 재시작 안내 표시
    }
  }

  function getExampleDisplayName(filename: string): string {
    if (filename === EMPTY_CONFIG_VALUE) {
      return $t('setup_wizard.empty_option');
    }
    const base = filename.replace(/\.homenet_bridge\.ya?ml$/, '');
    return base.charAt(0).toUpperCase() + base.slice(1).replace(/_/g, ' ');
  }

  function buildSerialConfigPayload() {
    if (!serialPath.trim()) {
      return null;
    }

    if (selectedExample !== EMPTY_CONFIG_VALUE) {
      return { path: serialPath.trim() };
    }

    const baudRateValue = Number(serialBaudRate);
    const dataBitsValue = Number(serialDataBits);
    const stopBitsValue = Number(serialStopBits);
    const portIdValue = serialPortId.trim();

    if (
      !portIdValue ||
      !Number.isFinite(baudRateValue) ||
      !Number.isFinite(dataBitsValue) ||
      !Number.isFinite(stopBitsValue)
    ) {
      return null;
    }

    return {
      portId: portIdValue,
      path: serialPath.trim(),
      baud_rate: baudRateValue,
      data_bits: dataBitsValue,
      parity: serialParity,
      stop_bits: stopBitsValue,
    };
  }

  function isFormReady() {
    return Boolean(buildSerialConfigPayload());
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
        // Don't close immediately if we want to show success or just wait for reload
        if (onSuccess) {
          onSuccess();
        } else {
          closeDialog();
        }
      } catch (err: any) {
        closeDialog();
        setTimeout(() => {
          dialog.title = $t('common.error') || 'Error';
          dialog.message = err.message || 'An error occurred';
          dialog.variant = 'danger';
          dialog.showCancel = false;
          dialog.confirmText = $t('common.confirm');
          dialog.loading = false;
          dialog.onConfirm = async () => closeDialog();
          dialog.open = true;
        }, 300);
      } finally {
        if (!onSuccess) dialog.loading = false;
      }
    };
    dialog.open = true;
  };

  // Restart Logic
  let isRestarting = $state(false);

  function handleRestart() {
    showConfirmDialog({
      title: $t('settings.app_control.title'), // "Application Control" or just "Restart"?
      // The original alert was just "Restarting..." AFTER action.
      // But usually we want to confirm before restart.
      // However, handleRestart in SetupWizard is called from a button that might already say "Restart".
      // Let's check the button calling it: onclick={handleRestart}
      // Usually it's better to confirm.
      message: $t('settings.app_control.restart_confirm'),
      confirmText: $t('settings.app_control.restart'),
      variant: 'danger',
      loadingText: $t('settings.app_control.restarting'),
      action: async () => {
        isRestarting = true;
        // 1. Get One-time Token
        const tokenRes = await fetch('./api/system/restart/token');
        if (!tokenRes.ok) throw new Error('Failed to get restart token');
        const { token } = await tokenRes.json();

        // 2. Send Restart Request with Token
        const res = await fetch('./api/system/restart', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Restart failed');
        }
      },
      onSuccess: () => {
        // Keep dialog open with "Restarting..." spinner?
        // My showConfirmDialog will keep loading true if onSuccess is provided?
        // Wait, I said "if (!onSuccess) dialog.loading = false".
        // So if onSuccess is present, loading stays true?
        // Yes, which is what we want (button stays spinning).

        // Reload after 5 sec
        setTimeout(() => {
          window.location.reload();
        }, 5000);
      },
    });
  }
</script>

{#snippet wizardContent()}
  <div class="setup-wizard" class:modal-view={mode === 'add'}>
    <div class="wizard-card" class:modal-view={mode === 'add'}>
      <div class="wizard-header">
        {#if mode === 'add'}
          <button class="header-close-btn" onclick={onclose} aria-label="Close">×</button>
        {:else}
          <button class="lang-toggle" onclick={toggleLocale}>
            {currentLocale === 'ko' ? 'EN' : '한국어'}
          </button>
        {/if}
        <h1>{mode === 'add' ? '브릿지 추가' : $t('setup_wizard.title')}</h1>
        <p class="subtitle">{$t('setup_wizard.subtitle')}</p>
      </div>

      <!-- Step indicator -->
      <div class="step-indicator" role="list">
        <div
          class="step"
          class:active={currentStep === 'config'}
          class:done={currentStep !== 'config'}
          role="listitem"
          aria-current={currentStep === 'config' ? 'step' : undefined}
        >
          <span class="step-number">1</span>
          <span class="step-label">{$t('setup_wizard.step_config')}</span>
        </div>
        <div class="step-line" aria-hidden="true"></div>
        <div
          class="step"
          class:active={currentStep === 'packet_defaults'}
          class:done={currentStep !== 'config' && currentStep !== 'packet_defaults'}
          role="listitem"
          aria-current={currentStep === 'packet_defaults' ? 'step' : undefined}
        >
          <span class="step-number">2</span>
          <span class="step-label">{$t('setup_wizard.step_packet_defaults')}</span>
        </div>
        <div class="step-line" aria-hidden="true"></div>
        <div
          class="step"
          class:active={currentStep === 'entity_selection'}
          class:done={currentStep === 'consent' || currentStep === 'complete'}
          role="listitem"
          aria-current={currentStep === 'entity_selection' ? 'step' : undefined}
        >
          <span class="step-number">3</span>
          <span class="step-label">{$t('setup_wizard.step_entities')}</span>
        </div>
        <div class="step-line" aria-hidden="true"></div>
        {#if mode !== 'add'}
          <div
            class="step"
            class:active={currentStep === 'consent'}
            class:done={currentStep === 'complete'}
            role="listitem"
            aria-current={currentStep === 'consent' ? 'step' : undefined}
          >
            <span class="step-number">4</span>
            <span class="step-label">{$t('setup_wizard.step_consent')}</span>
          </div>
        {/if}
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
              <option value={EMPTY_CONFIG_VALUE}>{$t('setup_wizard.empty_option')}</option>
              {#each examples as example (example)}
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

          <!-- Port ID field - shown for both empty config and examples -->
          <div class="form-group">
            <label for="serial-port-id">{$t('setup_wizard.serial_port_id_label')}</label>
            <input
              type="text"
              id="serial-port-id"
              bind:value={serialPortId}
              placeholder={$t('setup_wizard.serial_port_id_placeholder')}
              disabled={submitting}
            />
            <p class="field-hint">{$t('setup_wizard.serial_port_id_hint')}</p>
          </div>

          {#if selectedExample === EMPTY_CONFIG_VALUE}
            <div class="form-grid">
              <div class="form-group">
                <label for="serial-baud-rate">{$t('setup_wizard.serial_baud_rate_label')}</label>
                <input
                  type="number"
                  id="serial-baud-rate"
                  bind:value={serialBaudRate}
                  min="1"
                  step="1"
                  disabled={submitting}
                />
                <p class="field-hint">{$t('setup_wizard.serial_baud_rate_hint')}</p>
              </div>

              <div class="form-group">
                <label for="serial-data-bits">{$t('setup_wizard.serial_data_bits_label')}</label>
                <select id="serial-data-bits" bind:value={serialDataBits} disabled={submitting}>
                  <option value="5">5</option>
                  <option value="6">6</option>
                  <option value="7">7</option>
                  <option value="8">8</option>
                </select>
                <p class="field-hint">{$t('setup_wizard.serial_data_bits_hint')}</p>
              </div>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label for="serial-parity">{$t('setup_wizard.serial_parity_label')}</label>
                <select id="serial-parity" bind:value={serialParity} disabled={submitting}>
                  <option value="none">none</option>
                  <option value="even">even</option>
                  <option value="mark">mark</option>
                  <option value="odd">odd</option>
                  <option value="space">space</option>
                </select>
                <p class="field-hint">{$t('setup_wizard.serial_parity_hint')}</p>
              </div>

              <div class="form-group">
                <label for="serial-stop-bits">{$t('setup_wizard.serial_stop_bits_label')}</label>
                <select id="serial-stop-bits" bind:value={serialStopBits} disabled={submitting}>
                  <option value="1">1</option>
                  <option value="1.5">1.5</option>
                  <option value="2">2</option>
                </select>
                <p class="field-hint">{$t('setup_wizard.serial_stop_bits_hint')}</p>
              </div>
            </div>
            <p class="field-hint emphasis">{$t('setup_wizard.serial_manual_hint')}</p>
          {:else}
            <!-- Show example serial config info -->
            <div class="example-serial-info">
              <p class="info-label">{$t('setup_wizard.example_serial_info')}</p>
              {#if exampleSerialLoading}
                <p class="info-loading">{$t('setup_wizard.example_serial_loading')}</p>
              {:else if exampleSerialInfo}
                <div class="info-grid">
                  <div class="info-item">
                    <span class="info-key">Baud Rate</span>
                    <span class="info-value">{exampleSerialInfo.baud_rate ?? '-'}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-key">Data Bits</span>
                    <span class="info-value">{exampleSerialInfo.data_bits ?? '-'}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-key">Parity</span>
                    <span class="info-value">{exampleSerialInfo.parity ?? '-'}</span>
                  </div>
                  <div class="info-item">
                    <span class="info-key">Stop Bits</span>
                    <span class="info-value">{exampleSerialInfo.stop_bits ?? '-'}</span>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <div class="form-group">
            {#if hasTested && !error}
              <div class="serial-test-result">
                {#if testingSerial}
                  <p class="field-hint">{$t('setup_wizard.serial_test_wait')}</p>
                {:else if testPackets.length > 0}
                  <div class="result-list">
                    <div class="result-row">
                      <code>
                        {#each testPackets as packet, index (`${packet}-${index}`)}
                          {packet}
                        {/each}
                      </code>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}

            {#if testPackets.length > 0}
              <p class="success-hint">{$t('setup_wizard.serial_test_success')}</p>
            {/if}

            {#if error}
              <div class="error-message">{error}</div>
            {/if}

            <div class="button-group">
              <Button
                type="button"
                variant="secondary"
                onclick={handleSerialTest}
                disabled={submitting || testingSerial || !selectedExample || !isFormReady()}
                class="wizard-test-btn"
              >
                {$t('setup_wizard.serial_test_button')}
              </Button>

              <Button
                type="submit"
                variant="primary"
                isLoading={submitting || testingSerial}
                disabled={!selectedExample || !isFormReady()}
                class="wizard-submit-btn"
              >
                {#if !hasTested && testingSerial}
                  {$t('setup_wizard.serial_test_running')}
                {:else if hasTested && testPackets.length === 0 && error}
                  {$t('setup_wizard.ignore_and_next')}
                {:else}
                  {$t('setup_wizard.next')}
                {/if}
              </Button>
            </div>
          </div>
        </form>
      {:else if currentStep === 'packet_defaults'}
        <div class="wizard-step">
          <h3>{$t('setup_wizard.pdf_title')}</h3>
          <p class="step-desc">{$t('setup_wizard.pdf_desc')}</p>

          <div class="form-grid">
            <div class="form-group">
              <label for="rx_timeout">{$t('setup_wizard.pdf_rx_timeout')}</label>
              <input type="text" id="rx_timeout" bind:value={packetDefaults.rx_timeout} />
              <p class="field-hint">{$t('setup_wizard.pdf_rx_timeout_hint')}</p>
            </div>
            <div class="form-group">
              <label for="tx_delay">{$t('setup_wizard.pdf_tx_delay')}</label>
              <input type="text" id="tx_delay" bind:value={packetDefaults.tx_delay} />
              <p class="field-hint">{$t('setup_wizard.pdf_tx_delay_hint')}</p>
            </div>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label for="tx_timeout">{$t('setup_wizard.pdf_tx_timeout')}</label>
              <input type="text" id="tx_timeout" bind:value={packetDefaults.tx_timeout} />
              <p class="field-hint">{$t('setup_wizard.pdf_tx_timeout_hint')}</p>
            </div>
            <div class="form-group">
              <label for="tx_retry_cnt">{$t('setup_wizard.pdf_tx_retry_cnt')}</label>
              <input type="number" id="tx_retry_cnt" bind:value={packetDefaults.tx_retry_cnt} />
              <p class="field-hint">{$t('setup_wizard.pdf_tx_retry_cnt_hint')}</p>
            </div>
          </div>

          <hr class="params-divider" />

          <h4>{$t('setup_wizard.pdf_header_footer_title')}</h4>
          <p class="step-desc-sm">{$t('setup_wizard.pdf_header_footer_desc')}</p>

          <div class="form-grid">
            <div class="form-group">
              <label for="rx_header">{$t('setup_wizard.pdf_rx_header')}</label>
              <input
                type="text"
                id="rx_header"
                value={typeof packetDefaults.rx_header !== 'string'
                  ? JSON.stringify(packetDefaults.rx_header ?? [])
                  : packetDefaults.rx_header}
                oninput={(e) => (packetDefaults.rx_header = e.currentTarget.value)}
              />
            </div>
            <div class="form-group">
              <label for="rx_footer">{$t('setup_wizard.pdf_rx_footer')}</label>
              <input
                type="text"
                id="rx_footer"
                value={typeof packetDefaults.rx_footer !== 'string'
                  ? JSON.stringify(packetDefaults.rx_footer ?? [])
                  : packetDefaults.rx_footer}
                oninput={(e) => (packetDefaults.rx_footer = e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label for="tx_header">{$t('setup_wizard.pdf_tx_header')}</label>
              <input
                type="text"
                id="tx_header"
                value={typeof packetDefaults.tx_header !== 'string'
                  ? JSON.stringify(packetDefaults.tx_header ?? [])
                  : packetDefaults.tx_header}
                oninput={(e) => (packetDefaults.tx_header = e.currentTarget.value)}
              />
            </div>
            <div class="form-group">
              <label for="tx_footer">{$t('setup_wizard.pdf_tx_footer')}</label>
              <input
                type="text"
                id="tx_footer"
                value={typeof packetDefaults.tx_footer !== 'string'
                  ? JSON.stringify(packetDefaults.tx_footer ?? [])
                  : packetDefaults.tx_footer}
                oninput={(e) => (packetDefaults.tx_footer = e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="form-grid">
            <div class="form-group">
              <label for="rx_checksum">{$t('setup_wizard.pdf_rx_checksum')}</label>
              <input type="text" id="rx_checksum" bind:value={packetDefaults.rx_checksum} />
            </div>
            <div class="form-group">
              <label for="tx_checksum">{$t('setup_wizard.pdf_tx_checksum')}</label>
              <input type="text" id="tx_checksum" bind:value={packetDefaults.tx_checksum} />
            </div>
          </div>

          <div class="actions">
            <Button
              type="button"
              variant="secondary"
              onclick={handlePrevious}
              disabled={submitting}
            >
              {$t('setup_wizard.prev')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onclick={handleConfigSubmit}
              isLoading={submitting}
              disabled={submitting}
            >
              {$t('setup_wizard.next')}
            </Button>
          </div>
        </div>
      {:else if currentStep === 'entity_selection'}
        <div class="wizard-step">
          <h3>{$t('setup_wizard.entities_title')}</h3>
          <p class="step-desc">{$t('setup_wizard.entities_desc')}</p>

          {#if loadingEntities}
            <div class="loading-state">
              <p>{$t('setup_wizard.loading_entities')}</p>
            </div>
          {:else if Object.keys(entities).length === 0}
            <div class="empty-state">
              <p>{$t('setup_wizard.no_entities_found')}</p>
            </div>
          {:else}
            <div class="entity-list-container">
              {#each Object.entries(entities) as [type, items] (type)}
                <div class="entity-group">
                  <div class="entity-type-header">
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectedEntities[type]?.length === items.length}
                        indeterminate={selectedEntities[type]?.length > 0 &&
                          selectedEntities[type]?.length < items.length}
                        onchange={(e) => toggleType(type, e.currentTarget.checked)}
                      />
                      <span class="type-name">{$t(`entity_types.${type}`, { default: type })}</span>
                      <span class="type-count"
                        >({selectedEntities[type]?.length}/{items.length})</span
                      >
                    </label>
                  </div>
                  <div class="entity-items">
                    {#each items as item (item.id)}
                      <label class="checkbox-label entity-item">
                        <input
                          type="checkbox"
                          checked={selectedEntities[type]?.includes(item.id)}
                          onchange={(e) => toggleEntity(type, item.id, e.currentTarget.checked)}
                        />
                        <span class="entity-name">{item.name}</span>
                        <span class="entity-id">{item.id}</span>
                      </label>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <div class="actions">
            <Button
              type="button"
              variant="secondary"
              onclick={handlePrevious}
              disabled={submitting}
            >
              {$t('setup_wizard.prev')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onclick={handleConfigSubmit}
              isLoading={submitting}
              disabled={submitting}
            >
              {$t('setup_wizard.next')}
            </Button>
          </div>
        </div>
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
            <Button
              type="button"
              variant="secondary"
              onclick={handlePrevious}
              disabled={consentSubmitting}
              class="wizard-btn-flex"
            >
              {$t('setup_wizard.prev')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onclick={() => handleConsent(false)}
              disabled={consentSubmitting}
              class="wizard-btn-flex"
            >
              {$t('settings.log_sharing.consent_modal.decline')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onclick={() => handleConsent(true)}
              disabled={consentSubmitting}
              class="wizard-btn-flex"
            >
              {$t('settings.log_sharing.consent_modal.accept')}
            </Button>
          </div>
        </div>
      {:else if currentStep === 'complete'}
        <div class="success-state">
          {#if requiresManualUpdate}
            <div class="warning-icon">!</div>
            <p class="warning-message">
              {$t('setup_wizard.manual_config_update_required', {
                values: { filename: createdFilename },
              })}
            </p>
          {:else}
            <div class="success-icon">✓</div>
            <p class="success-message">{$t('setup_wizard.success_message')}</p>
            <p class="hint">{$t('setup_wizard.restarting')}</p>
            <div class="restart-action">
              <Button
                variant="primary"
                onclick={handleRestart}
                isLoading={isRestarting}
                disabled={isRestarting}
              >
                {$t('settings.app_control.restart')}
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#if mode === 'add'}
  <Modal open={true} width="800px" {onclose} oncancel={onclose}>
    <div class="modal-content-wrapper">
      {@render wizardContent()}
    </div>
  </Modal>
{:else}
  {@render wizardContent()}
{/if}

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

<style>
  /* ... existing styles ... */
  .entity-list-container {
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.3);
    margin-bottom: 2rem;
    padding: 1rem;
  }

  .entity-group {
    margin-bottom: 1.5rem;
  }

  .entity-group:last-child {
    margin-bottom: 0;
  }

  .entity-type-header {
    background: rgba(51, 65, 85, 0.5);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    margin-bottom: 0.5rem;
    font-weight: 600;
  }

  .type-name {
    text-transform: capitalize;
    margin-right: 0.5rem;
  }

  .type-count {
    color: #94a3b8;
    font-size: 0.875rem;
    font-weight: normal;
  }

  .entity-items {
    padding-left: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .entity-item {
    font-size: 0.95rem;
  }

  .entity-id {
    color: #64748b;
    font-size: 0.8rem;
    margin-left: 0.5rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-label input[type='checkbox'] {
    margin-right: 0.75rem;
    width: 1.1em;
    height: 1.1em;
    accent-color: #3b82f6;
  }

  .setup-wizard {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 80dvh;
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

  .field-hint.emphasis {
    margin-top: 0;
    color: #e2e8f0;
  }

  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .serial-test-result {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border-radius: 8px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(15, 23, 42, 0.7);
  }

  .result-list {
    display: flex;
    gap: 0.5rem;
  }

  .result-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #e2e8f0;
    font-family:
      'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    word-break: break-all;
  }

  .success-hint {
    background: rgba(68, 239, 77, 0.1);
    border: 1px solid rgba(68, 239, 77, 0.3);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #10b981;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
  }

  .error-message {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 0.75rem 1rem;
    color: #ef4444;
    font-size: 0.9rem;
    margin: 0.75rem 0;
  }

  /* Style tweaks for Button component variants to match wizard style if needed,
     but default Button styles are close enough. */
  :global(.wizard-submit-btn) {
    padding: 0.875rem 1.5rem !important; /* Larger hit area */
    font-size: 1rem !important;
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

  :global(.wizard-btn-flex) {
    flex: 1;
    padding: 0.875rem 1.5rem !important;
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

  .warning-icon {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    color: white;
    font-size: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    margin: 0 auto 1rem;
  }

  .warning-message {
    color: #f59e0b;
    font-weight: 600;
    font-size: 1.1rem;
    margin: 0 0 0.5rem 0;
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

  .restart-action {
    margin-top: 2rem;
    display: flex;
    justify-content: center;
  }

  /* Example serial config info styles */
  .example-serial-info {
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 0.5rem;
  }

  .example-serial-info .info-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #94a3b8;
    margin: 0 0 0.75rem 0;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .example-serial-info .info-loading {
    font-size: 0.85rem;
    color: #64748b;
    font-style: italic;
    margin: 0;
  }

  .example-serial-info .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem 1rem;
  }

  .example-serial-info .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.35rem 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .example-serial-info .info-key {
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .example-serial-info .info-value {
    font-size: 0.9rem;
    font-weight: 600;
    color: #e2e8f0;
    font-family:
      'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  }

  /* Packet Defaults Step Styles */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 2rem;
  }
  .wizard-step h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
    font-size: 1.25rem;
    color: #e2e8f0;
  }
  .step-desc {
    margin-bottom: 1.5rem;
    color: #94a3b8;
    font-size: 0.95rem;
  }
  .step-desc-sm {
    margin-bottom: 1rem;
    color: #94a3b8;
    font-size: 0.85rem;
  }
  .params-divider {
    border: 0;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    margin: 2rem 0;
  }

  .button-group {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
  }

  .button-group > :global(*) {
    flex: 1;
  }
  h4 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
    color: #e2e8f0;
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
  /* Modal Styles for SetupWizard */
  .modal-content-wrapper {
    position: relative;
    width: 100%;
    height: 90dvh;
    overflow-y: auto;
    padding: 1rem;
    box-sizing: border-box;
  }

  .header-close-btn {
    position: absolute;
    top: 0;
    right: 0;
    width: 36px;
    height: 36px;
    background: rgba(148, 163, 184, 0.15);
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 6px; /* Match lang-toggle radius, or use circle? User asked to replace lang button spot */
    color: #94a3b8;
    cursor: pointer;
    font-size: 1.5rem;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.2s;
  }
  .header-close-btn:hover {
    background: rgba(148, 163, 184, 0.25);
    color: #e2e8f0;
  }

  /* Modal View overrides */
  .setup-wizard.modal-view {
    min-height: auto;
    padding: 0;
  }

  .wizard-card.modal-view {
    background: none;
    border: none;
    box-shadow: none;
    padding: 1.5rem 0.5rem; /* Reduce padding as modal wrapper has padding */
    max-width: none;
  }
</style>
