import yaml from 'js-yaml';
import type { HomenetBridgeConfig } from '@rs485-homenet/core';
import { ENTITY_TYPE_KEYS } from './constants.js';

class HexSeqWrapper {
  items: unknown[];
  constructor(items: unknown[]) {
    this.items = items;
  }
}

const HexSeqType = new yaml.Type('!hexSeq', {
  kind: 'scalar',
  instanceOf: HexSeqWrapper,
  represent: (obj: any) => {
    // Format each item as 0xXX and join with comma
    const hexItems = obj.items.map((v: unknown) => {
      if (typeof v === 'number') {
        return `0x${v.toString(16).padStart(2, '0').toUpperCase()}`;
      }
      return v;
    });
    return '[' + hexItems.join(', ') + ']';
  },
});

const SCHEMA = yaml.DEFAULT_SCHEMA.extend([HexSeqType]);

function markHex(obj: any): any {
  if (Array.isArray(obj)) {
    // Arrays inside arrays?
    return obj.map(markHex);
  }
  if (obj && typeof obj === 'object') {
    // Only traverse plain objects to avoid breaking Date, RegExp, etc.
    if (obj.constructor !== Object) {
      return obj;
    }
    const newObj: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        // Skip 'type' or 'unique_id' if it's one of the entity types (redundant in YAML)
        if (key === 'unique_id' || (key === 'type' && ENTITY_TYPE_KEYS.includes(value as any))) {
          continue;
        }

        // Identify keys that should contain byte arrays and convert the ARRAY to HexSeqWrapper
        if (
          (key.startsWith('state') ||
            key.startsWith('command') ||
            key.includes('header') ||
            key.includes('footer') ||
            key === 'ack' ||
            key === 'mask' ||
            key === 'data') &&
          Array.isArray(value)
        ) {
          const isNumericArray = value.every((item) => typeof item === 'number');

          if (isNumericArray && value.length > 0) {
            newObj[key] = new HexSeqWrapper(value);
          } else {
            // Recurse for non-numeric arrays (e.g. list of objects)
            newObj[key] = markHex(value);
          }
        } else if (key.startsWith('state') || key.startsWith('command')) {
          // Recursively handle nested objects in state/command (e.g. state_on: { data: ... })
          newObj[key] = markHex(value);
        } else {
          // Recursively handle other objects
          newObj[key] = markHex(value);
        }
      }
    }
    return newObj;
  }
  return obj;
}

export function dumpConfigToYaml(
  config: Partial<HomenetBridgeConfig> | Record<string, any>,
  options: yaml.DumpOptions = {},
): string {
  const markedConfig = markHex(config);
  const dump = yaml.dump(markedConfig, {
    schema: SCHEMA,
    noRefs: true,
    ...options,
    lineWidth: -1, // Force infinite line width to ensure hex arrays are not wrapped, which would break the regex replacement
  });

  // Remove the !hexSeq tag and quotes around the flow array string
  // Matches !hexSeq '[ ... ]'
  // Use non-greedy match .*? to handle multiple occurrences on different lines (though regex is per line if multiline flag not set, but JS dot matches everything except newline usually)
  // Actually js-yaml will output: key: !hexSeq '[...]'
  return dump.replace(/!hexSeq ['"](.*?)['"]/g, '$1');
}
