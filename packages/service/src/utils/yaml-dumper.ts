import yaml from 'js-yaml';

class HexSeqWrapper {
  constructor(public items: any[]) {}
}

const HexSeqType = new yaml.Type('!hexSeq', {
  kind: 'scalar',
  instanceOf: HexSeqWrapper,
  represent: (obj: any) => {
    // Format each item as 0xXX and join with comma
    const hexItems = obj.items.map((v: any) => {
      if (typeof v === 'number') {
        const h = v.toString(16).toUpperCase();
        return '0x' + (h.length < 2 ? '0' + h : h);
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
          // Verify if it contains numbers?
          // If it contains only numbers, we wrap it.
          // If it contains objects (e.g. nested schema), we probably shouldn't wrap the whole array as hex seq string?
          // But user said "hex로 표시하는배열" (arrays displayed as hex).
          // Byte arrays usually contain numbers.
          const isNumericArray = value.every(
            (item) => typeof item === 'number' || typeof item === 'string', // Allow strings if already hex? No, we transform.
          );

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

export function dumpConfigToYaml(config: any, options: yaml.DumpOptions = {}): string {
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
