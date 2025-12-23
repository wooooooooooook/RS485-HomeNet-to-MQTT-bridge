import { register, init, getLocaleFromNavigator } from 'svelte-i18n';

register('en', () => import('./locales/en.json'));
register('ko', () => import('./locales/ko.json'));

init({
  fallbackLocale: 'ko',
  initialLocale: getLocaleFromNavigator() || 'ko',
  handleMissingMessage: ({ locale, id }) => {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] Missing key: "${id}" for locale: "${locale}"`);
    }
  },
});
