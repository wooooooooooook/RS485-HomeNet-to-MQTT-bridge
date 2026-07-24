const { performance } = require('perf_hooks');

const configKey = 'light';
const ENTITY_TYPE_KEYS = ['light', 'switch', 'sensor', 'climate'];
const normalizedFullConfig = {
  light: Array.from({ length: 10000 }, (_, i) => ({ id: `light_${i}` })),
  switch: Array.from({ length: 10000 }, (_, i) => ({ id: `switch_${i}` })),
  sensor: Array.from({ length: 10000 }, (_, i) => ({ id: `sensor_${i}` })),
  climate: Array.from({ length: 10000 }, (_, i) => ({ id: `climate_${i}` })),
};
const targetList = normalizedFullConfig[configKey];
const newEntries = Array.from({ length: 1000 }, (_, i) => ({ id: `new_light_${i}` }));

function original() {
  const start = performance.now();
  for (const newItem of newEntries) {
    if (newItem.id) {
      const duplicate = targetList.find((existing) => existing.id === newItem.id);
      if (duplicate) {
        return false;
      }
      if (ENTITY_TYPE_KEYS.includes(configKey)) {
        for (const otherKey of ENTITY_TYPE_KEYS) {
          if (otherKey === configKey) continue;
          const otherList = normalizedFullConfig[otherKey];
          if (Array.isArray(otherList) && otherList.some((e) => e.id === newItem.id)) {
            return false;
          }
        }
      }
    }
  }
  return performance.now() - start;
}

function optimized() {
  const start = performance.now();

  const existingIds = new Set(targetList.map((e) => e.id).filter(Boolean));
  const otherListsIds = new Map();
  if (ENTITY_TYPE_KEYS.includes(configKey)) {
    for (const otherKey of ENTITY_TYPE_KEYS) {
      if (otherKey === configKey) continue;
      const otherList = normalizedFullConfig[otherKey];
      if (Array.isArray(otherList)) {
        otherListsIds.set(otherKey, new Set(otherList.map((e) => e.id).filter(Boolean)));
      }
    }
  }

  for (const newItem of newEntries) {
    if (newItem.id) {
      if (existingIds.has(newItem.id)) {
        return false;
      }
      if (ENTITY_TYPE_KEYS.includes(configKey)) {
        for (const [otherKey, idsSet] of otherListsIds.entries()) {
          if (idsSet.has(newItem.id)) {
            return false;
          }
        }
      }
    }
  }
  return performance.now() - start;
}

const origTime = original();
const optTime = optimized();

console.log(`Original: ${origTime.toFixed(2)} ms`);
console.log(`Optimized: ${optTime.toFixed(2)} ms`);
