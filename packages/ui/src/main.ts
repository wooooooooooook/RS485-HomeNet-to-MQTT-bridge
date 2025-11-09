import App from './App.svelte';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Failed to find app element');
}

const app = new App({
  target
});

export default app;
