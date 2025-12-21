import yaml from 'js-yaml';

class HexWrapper {
  constructor(public value: number) {}
}

const HexType = new yaml.Type('!hex', {
  kind: 'scalar',
  instanceOf: HexWrapper,
  represent: (obj: any) => {
    // Format as 0xXX (uppercase, minimum 2 digits)
    const hex = obj.value.toString(16).toUpperCase();
    return '0x' + (hex.length < 2 ? '0' + hex : hex);
  },
});

const SCHEMA = yaml.DEFAULT_SCHEMA.extend([HexType]);

function markHex(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(markHex);
  }
  if (obj && typeof obj === 'object') {
    const newObj: Record<string, any> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        // Identify keys that should contain byte arrays and convert numbers to HexWrapper
        if (
          (key.startsWith('state') ||
            key.startsWith('command') ||
            key.includes('header') ||
            key.includes('footer') ||
            key === 'data') &&
          Array.isArray(value)
        ) {
          newObj[key] = value.map((item: any) => {
            if (typeof item === 'number') {
              return new HexWrapper(item);
            }
            return item;
          });
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
    lineWidth: -1,
    ...options,
  });

  // Remove the !hex tag and quotes from the output
  // Matches !hex '0xXX' and replaces with 0xXX
  return dump.replace(/!hex ['"]0x([0-9a-fA-F]+)['"]/g, '0x$1');
}
