import { mount } from 'svelte';
import App from './App.svelte';

type RuntimeErrorPayload = {
  message: string;
  detail?: string;
  timestamp: string;
};

declare global {
  interface Window {
    __runtimeErrorQueue?: RuntimeErrorPayload[];
  }
}

const runtimeErrorEventName = 'runtime-error';

const getRuntimeErrorQueue = () => {
  if (!window.__runtimeErrorQueue) {
    window.__runtimeErrorQueue = [];
  }
  return window.__runtimeErrorQueue;
};

const formatRuntimeErrorDetail = (error: unknown) => {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return undefined;
  }
};

const emitRuntimeError = (payload: RuntimeErrorPayload) => {
  const queue = getRuntimeErrorQueue();
  queue.push(payload);
  window.dispatchEvent(new CustomEvent(runtimeErrorEventName, { detail: payload }));
};

const handleRuntimeError = (message: string, detail?: string) => {
  emitRuntimeError({
    message,
    detail,
    timestamp: new Date().toISOString(),
  });
};

const handleErrorEvent = (event: ErrorEvent) => {
  const detail = event.error ? formatRuntimeErrorDetail(event.error) : undefined;
  handleRuntimeError(event.message || 'Unknown error', detail);
};

const handleRejectionEvent = (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  const detail = formatRuntimeErrorDetail(reason);
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Unhandled promise rejection';
  handleRuntimeError(message, detail);
};

window.addEventListener('error', handleErrorEvent);
window.addEventListener('unhandledrejection', handleRejectionEvent);

const target = document.getElementById('app');

if (!target) {
  const errorMessage = 'Failed to find app element';
  document.body.innerHTML = `
    <div style="font-family: system-ui, sans-serif; padding: 24px; background: #0f172a; color: #e2e8f0; min-height: 100vh;">
      <h1 style="margin: 0 0 12px; font-size: 20px;">앱을 시작할 수 없습니다</h1>
      <p style="margin: 0 0 16px;">${errorMessage}</p>
      <p style="margin: 0; color: #94a3b8;">페이지를 새로고침하거나 로그를 확인해주세요.</p>
    </div>
  `;
  throw new Error(errorMessage);
}

const app = mount(App, { target });

export default app;
