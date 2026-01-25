<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { BridgeErrorPayload, BridgeSerialInfo, BridgeStatus } from '../types';

  interface PortMetadata extends BridgeSerialInfo {
    configFile: string;
    error?: string;
    errorInfo?: BridgeErrorPayload | null;
    status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
  }

  let {
    mqttUrl,
    mqttStatus = 'idle',
    portMetadata,
    bridgeStatus = 'unknown',
    globalError = null,
    mqttError = null,
    serialError = null,
  }: {
    mqttUrl: string;
    mqttStatus?: 'idle' | 'connecting' | 'connected' | 'error';
    portMetadata?: PortMetadata;
    bridgeStatus?: BridgeStatus | 'unknown';
    globalError?: BridgeErrorPayload | null;
    mqttError?: string | null;
    serialError?: string | null;
  } = $props();

  // Helper to determine if a node has an error
  const hasSerialError = $derived(
    (portMetadata?.errorInfo?.source === 'serial' && portMetadata.errorInfo.severity === 'error') ||
      !!serialError,
  );

  const hasCoreError = $derived(
    bridgeStatus === 'error' ||
      (globalError?.source === 'core' && globalError.severity === 'error') ||
      (globalError?.source === 'service' && globalError.severity === 'error'),
  );

  const hasMqttError = $derived(mqttStatus === 'error' || !!mqttError);

  const hasSerialWarning = $derived(!hasSerialError && isWarning(portMetadata?.status));
  const hasCoreWarning = $derived(!hasCoreError && isWarning(bridgeStatus));
  const hasMqttWarning = $derived(!hasMqttError && isWarning(mqttStatus));

  // DEBUG: Log all error states for debugging
  $effect(() => {
    if (import.meta.env.DEV) {
      console.log('[SystemTopology] Error States Debug:', {
        bridgeStatus,
        mqttStatus,
        portMetadataStatus: portMetadata?.status,
        globalError,
        mqttError,
        serialError,
        portMetadataError: portMetadata?.error,
        portMetadataErrorInfo: portMetadata?.errorInfo,
        // Derived states
        hasSerialError,
        hasCoreError,
        hasMqttError,
        hasSerialWarning,
        hasCoreWarning,
        hasMqttWarning,
      });
    }
  });

  function isGreen(status: string | undefined) {
    return status === 'connected' || status === 'started';
  }

  function isWarning(status: string | undefined) {
    return status === 'connecting' || status === 'starting' || status === 'reconnecting';
  }

  function getStatusColor(status: string | undefined, hasError: boolean) {
    if (hasError) return 'var(--status-error, #ef4444)';
    switch (status) {
      case 'connected':
      case 'started':
        return 'var(--status-success, #10b981)';
      case 'connecting':
      case 'starting':
      case 'reconnecting':
        return 'var(--status-warning, #f59e0b)';
      case 'idle':
      case 'stopped':
      default:
        return 'var(--status-neutral, #64748b)';
    }
  }

  function getStatusLabel(status: string | undefined) {
    if (!status) return 'unknown';
    return status;
  }
</script>

<div class="topology-container">
  <!-- Top Section: Visual Graph (7 slots: Spacer - Node - Link - Node - Link - Node - Spacer) -->
  <div class="graph-section">
    <!-- Side Gutter -->
    <div class="link-visual spacer"></div>

    <!-- Node 1: Serial Device -->
    <div class="node-visual">
      <div
        class="node"
        class:error={hasSerialError}
        class:warning={hasSerialWarning}
        style="--status-color: {getStatusColor(portMetadata?.status, hasSerialError)}"
      >
        <div class="icon-circle">
          <!-- Chip/Serial Icon -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"
            />
            <path d="M9 9h.01" />
            <path d="M15 9h.01" />
          </svg>
        </div>
        <div class="node-label">
          {$t('dashboard.topology.serial_device', { default: 'RS485 Serial Device' })}
        </div>
        {#if hasSerialError}
          <div class="error-badge" title={serialError || portMetadata?.error || ''}>!</div>
        {/if}
      </div>
    </div>

    <!-- Link 1: Serial Connection -->
    <div class="link-visual link-rs485">
      <div
        class="connection-line"
        class:active={portMetadata?.status === 'started'}
        class:warning={isWarning(portMetadata?.status)}
      ></div>
    </div>

    <!-- Node 2: Core -->
    <div class="node-visual">
      <div
        class="node"
        class:error={hasCoreError}
        class:warning={hasCoreWarning}
        style="--status-color: {getStatusColor(bridgeStatus, hasCoreError)}"
      >
        <div class="icon-circle">
          <!-- Server Icon -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
        </div>
        <div class="node-label">
          {$t('dashboard.topology.homenet2mqtt', { default: 'HomeNet2MQTT' })}
        </div>
        {#if hasCoreError}
          <div class="error-badge" title={globalError?.message || ''}>!</div>
        {/if}
      </div>
    </div>

    <!-- Link 2: MQTT Connection -->
    <div class="link-visual link-mqtt">
      <div
        class="connection-line"
        class:active={mqttStatus === 'connected' && portMetadata?.status === 'started'}
        class:warning={isWarning(mqttStatus)}
      ></div>
    </div>

    <!-- Node 3: MQTT Broker -->
    <div class="node-visual">
      <div
        class="node"
        class:error={hasMqttError}
        class:warning={hasMqttWarning}
        style="--status-color: {getStatusColor(mqttStatus, hasMqttError)}"
      >
        <div class="icon-circle">
          <!-- Cloud Icon -->
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          </svg>
        </div>
        <div class="node-label">
          {$t('dashboard.topology.mqtt_broker', { default: 'MQTT Broker' })}
        </div>
        {#if hasMqttError}
          <div class="error-badge" title={mqttError || ''}>!</div>
        {/if}
      </div>
    </div>

    <!-- Side Gutter -->
    <div class="link-visual spacer"></div>
  </div>

  <!-- Bottom Section: Details Grid (3 columns) -->
  <div class="details-section">
    <!-- Side Gutter -->
    <div class="detail-spacer"></div>

    <!-- Details 1: Serial (Left aligned) -->
    <div class="details-column left">
      <div class="mobile-node-name">
        <span class="value">
          {$t('dashboard.topology.serial_device', { default: 'RS485 Serial Device' })}
        </span>
      </div>
      {#if hasSerialError || !isGreen(portMetadata?.status)}
        <div class="detail-item">
          <span
            class="value"
            class:error-text={hasSerialError}
            style:color={!hasSerialError ? getStatusColor(portMetadata?.status, false) : undefined}
          >
            {hasSerialError
              ? serialError || portMetadata?.error || $t('common.status.error')
              : $t(`common.status.${getStatusLabel(portMetadata?.status)}`)}
          </span>
        </div>
      {/if}
      <div class="detail-item" title={portMetadata?.path}>
        <span class="label">{$t('dashboard.topology.path', { default: 'PATH' })}</span>
        <span class="value">{portMetadata?.path || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="label">{$t('dashboard.topology.baud', { default: 'BAUD' })}</span>
        <span class="value">{portMetadata?.baudRate || '-'}</span>
      </div>
    </div>

    <!-- Link Gap -->
    <div class="link-gap"></div>

    <!-- Details 2: Core (Center aligned) -->
    <div class="details-column center">
      <div class="mobile-node-name">
        <span class="value">
          {$t('dashboard.topology.homenet2mqtt', { default: 'HomeNet2MQTT' })}
        </span>
      </div>
      {#if hasCoreError || !isGreen(bridgeStatus)}
        <div class="detail-item">
          <span
            class="value"
            class:error-text={hasCoreError}
            style:color={!hasCoreError ? getStatusColor(bridgeStatus, false) : undefined}
          >
            {hasCoreError
              ? globalError?.message || $t('common.status.error')
              : $t(`common.status.${getStatusLabel(bridgeStatus)}`)}
          </span>
        </div>
      {/if}
      <div class="detail-item" title={portMetadata?.configFile}>
        <span class="label">{$t('dashboard.topology.config', { default: 'CONFIG' })}</span>
        <span class="value">{portMetadata?.configFile || '-'}</span>
      </div>
      <div class="detail-item">
        <span class="label">{$t('dashboard.topology.port', { default: 'PORT' })}</span>
        <span class="value">{portMetadata?.portId || '-'}</span>
      </div>
    </div>

    <!-- Link Gap -->
    <div class="link-gap"></div>

    <!-- Details 3: MQTT (Right aligned) -->
    <div class="details-column right">
      <div class="mobile-node-name">
        <span class="value">
          {$t('dashboard.topology.mqtt_broker', { default: 'MQTT Broker' })}
        </span>
      </div>
      {#if hasMqttError || !isGreen(mqttStatus)}
        <div class="detail-item">
          <span
            class="value"
            class:error-text={hasMqttError}
            style:color={!hasMqttError ? getStatusColor(mqttStatus, false) : undefined}
          >
            {hasMqttError
              ? mqttError || $t('common.status.error')
              : $t(`common.status.${getStatusLabel(mqttStatus)}`)}
          </span>
        </div>
      {/if}
      <div class="detail-item" title={mqttUrl}>
        <span class="label">{$t('dashboard.topology.url', { default: 'URL' })}</span>
        <span class="value">{mqttUrl}</span>
      </div>
      <div class="detail-item">
        <span class="label">{$t('dashboard.topology.subscription', { default: 'SUB' })}</span>
        <span class="value">{portMetadata?.topic ? portMetadata.topic + '/#' : '-'}</span>
      </div>
    </div>

    <!-- Side Gutter -->
    <div class="detail-spacer"></div>
  </div>
</div>

<style>
  .topology-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 2rem 1rem 1.5rem 1rem;
    background: rgba(30, 41, 59, 0.4);
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 12px;
    width: 100%;
    box-sizing: border-box;
  }

  /* --- Top Section: 5 Columns + 2 Spacers --- */
  .graph-section {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    width: 100%;
    position: relative;
  }

  /* Node Visuals */
  .node-visual {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 80px; /* Fixed width for icon centering */
    flex-shrink: 0;
    z-index: 2; /* Above lines */
  }

  .node {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
  }

  .icon-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #1e293b; /* Solid background to cover lines if needed */
    border: 2px solid var(--status-color);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--status-color);
    box-shadow: 0 0 15px rgba(0, 0, 0, 0.2);
    transition: all 0.3s ease;
  }

  .node.error .icon-circle {
    animation: pulse-error 2s infinite;
  }

  .node.warning .icon-circle {
    animation: pulse-warning 2s infinite;
  }

  .icon-circle svg {
    width: 32px;
    height: 32px;
  }

  .node-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #e2e8f0;
    text-align: center;
    white-space: nowrap;
    position: absolute;
    top: 72px; /* Place below circle */
    width: 200px; /* Allow wider text */
  }

  .error-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 24px;
    height: 24px;
    background: #ef4444;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: bold;
    border: 3px solid #1e293b;
    cursor: help;
  }

  /* Link Visuals */
  .link-visual {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    height: 64px; /* Match icon height */
    justify-content: center;
  }

  /* Spacer is 50% of the length of other links */
  .link-visual.spacer {
    flex: 0.2;
  }

  .connection-line {
    width: 100%;
    height: 2px;
    background: rgba(148, 163, 184, 0.2);
    position: relative;
  }

  .connection-line.active {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.3);
  }

  .connection-line.warning {
    background: var(--status-warning, #f59e0b);
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.3);
    animation: line-pulse-warning 2s infinite ease-in-out;
  }

  .connection-line.active::after {
    content: '';
    position: absolute;
    width: 6px;
    height: 6px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 0 6px white;
    top: 50%;
    left: 0;
    transform: translate(-100%, -50%);
    animation: move-dot-horizontal 2s linear infinite;
    opacity: 0.8;
  }

  /* Offset for MQTT link so they don't overlap */
  .link-mqtt .connection-line.active::after {
    animation-delay: 1s;
  }

  /* --- Bottom Section: Perfectly Aligned Flex --- */
  .details-section {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    width: 100%;
    padding-top: 0.5rem;
  }

  .detail-spacer {
    flex: 0.2; /* Match graph spacer */
  }

  .link-gap {
    flex: 1; /* Match graph link */
  }

  .details-column {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 80px; /* Match node-visual width */
    flex-shrink: 0;
    min-width: 0;
  }

  /* Column Alignments */
  .details-column.left {
    align-items: flex-start;
    text-align: left;
  }

  .details-column.center {
    align-items: center;
    text-align: center;
  }

  .details-column.right {
    align-items: flex-end;
    text-align: right;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    width: max-content; /* Allow text to be wider than 80px */
    max-width: 400%; /* Prevents extreme overflow */
  }

  /* Align inner items based on column class */
  .details-column.left .detail-item {
    align-items: flex-start;
  }
  .details-column.center .detail-item {
    align-items: center;
  }
  .details-column.right .detail-item {
    align-items: flex-end;
  }

  .detail-item .label {
    font-size: 0.65rem;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.05em;
    margin-bottom: 0.2rem;
  }

  .detail-item .value {
    font-family: monospace;
    font-size: 0.85rem;
    color: #94a3b8;
    word-break: break-all; /* Allow wrapping for long paths */
    line-height: 1.2;
  }

  .mobile-node-name {
    display: none;
  }

  @keyframes move-dot-horizontal {
    0% {
      left: 0;
      transform: translate(-100%, -50%);
      opacity: 0;
    }
    5% {
      left: 5%;
      transform: translate(-100%, -50%);
      opacity: 0.8;
    }
    95% {
      left: 98%;
      transform: translate(0, -50%);
      opacity: 0.8;
    }
    100% {
      left: 100%;
      transform: translate(0, -50%);
      opacity: 0;
    }
  }

  @keyframes move-dot-vertical {
    0% {
      top: 0;
      transform: translate(-50%, -100%);
      opacity: 0;
    }
    5% {
      top: 5%;
      transform: translate(-50%, -100%);
      opacity: 0.8;
    }
    95% {
      top: 98%;
      transform: translate(-50%, 0);
      opacity: 0.8;
    }
    100% {
      top: 100%;
      transform: translate(-50%, 0);
      opacity: 0;
    }
  }

  @keyframes pulse-error {
    0% {
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
    }
    70% {
      box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
    }
  }

  @keyframes pulse-warning {
    0% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4);
    }
    70% {
      box-shadow: 0 0 0 10px rgba(245, 158, 11, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    }
  }

  @keyframes line-pulse-warning {
    0%,
    100% {
      opacity: 0.6;
      box-shadow: 0 0 4px rgba(245, 158, 11, 0.2);
    }
    50% {
      opacity: 1;
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);
    }
  }

  /* Responsive Mobile */
  @media (max-width: 768px) {
    .spacer,
    .detail-spacer,
    .link-gap {
      display: none;
    }
    .topology-container {
      flex-direction: row; /* Side-by-side: Graph on left, Text on right */
      padding: 1rem 0.5rem;
      gap: 1rem;
      align-items: stretch;
    }

    .graph-section {
      flex-direction: column;
      width: min-content;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
      padding-right: 0.5rem;
    }

    .node-visual {
      width: 48px;
      height: 48px;
      justify-content: center;
    }

    .icon-circle {
      width: 44px;
      height: 44px;
    }

    .icon-circle svg {
      width: 22px;
      height: 22px;
    }

    .node-label {
      display: none;
    }

    .link-visual,
    .link-visual.spacer {
      width: 2px;
      height: 36px;
      flex: none;
      padding: 0;
    }

    .connection-line {
      width: 2px;
      height: 100%;
    }

    .connection-line.active::after {
      left: 50%;
      top: 0;
      transform: translate(-50%, -100%);
      animation: move-dot-vertical 1s linear infinite;
      background: white;
      background-size: initial;
    }

    .link-mqtt .connection-line.active::after {
      animation-delay: 0.5s;
    }

    .details-section {
      flex-direction: column;
      flex: 1;
      padding-top: 0;
      gap: 16px;
      justify-content: flex-start;
    }

    .detail-spacer {
      height: 32px;
      flex: none;
    }

    .link-gap {
      height: 32px;
      flex: none;
    }

    .details-column {
      width: 100%;
      justify-content: flex-start;
      align-items: flex-start !important;
      text-align: left !important;
      gap: 0;
      flex-direction: row;
      flex-wrap: wrap;
      column-gap: 1rem;
      min-height: 48px;
    }

    .details-column.left,
    .details-column.center,
    .details-column.right {
      width: 100%;
      align-items: flex-start;
      text-align: left;
    }

    .details-column .detail-item {
      align-items: flex-start !important;
      max-width: 100%;
    }

    .detail-item .label {
      font-size: 0.55rem;
      margin-bottom: 0;
    }

    .detail-item .value {
      font-size: 0.75rem;
      white-space: normal;
      word-break: break-all;
    }

    .mobile-node-name {
      display: flex;
      width: 100%;
      margin-bottom: 0.25rem;
    }

    .mobile-node-name .value {
      font-weight: 700 !important;
      color: #e2e8f0 !important;
      font-size: 0.85rem !important;
      font-family: inherit !important;
      word-break: keep-all;
    }
  }

  .error-text {
    color: #ef4444 !important;
    font-weight: 600;
  }
</style>
