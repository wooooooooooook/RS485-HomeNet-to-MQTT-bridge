const SIGNATURE_FIELDS = [
  'data',
  'mask',
  'offset',
  'regex',
  'value',
  'length',
  'checksum',
  'header',
  'footer',
  'low_priority',
];

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      sorted[key] = sortKeys(entryValue);
    }
    return sorted;
  }

  return value;
};

const stableStringify = (value: unknown): string => JSON.stringify(sortKeys(value));

const buildSchemaSignature = (schema: unknown): unknown => {
  if (!schema) return null;

  if (Array.isArray(schema) || typeof schema === 'string' || typeof schema === 'number') {
    return sortKeys(schema);
  }

  if (typeof schema !== 'object') return null;

  const signature: Record<string, unknown> = {};
  for (const field of SIGNATURE_FIELDS) {
    if (field in (schema as Record<string, unknown>)) {
      signature[field] = sortKeys((schema as Record<string, unknown>)[field]);
    }
  }

  return Object.keys(signature).length > 0 ? signature : null;
};

export const buildEntitySignature = (
  entityType: string,
  entity: Record<string, unknown>,
): string | null => {
  const stateSignature = buildSchemaSignature(entity.state);
  const commands: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith('command_')) continue;
    const commandSignature = buildSchemaSignature(value);
    if (commandSignature) {
      commands[key] = commandSignature;
    }
  }

  if (!stateSignature && Object.keys(commands).length === 0) {
    return null;
  }

  return stableStringify({
    entityType,
    state: stateSignature,
    commands: Object.keys(commands).length > 0 ? commands : undefined,
  });
};

// --- Similarity-based matching ---

export interface EntitySignatureObject {
  entityType: string;
  state: Record<string, unknown> | null;
  commands: Record<string, Record<string, unknown>> | null;
}

export const buildEntitySignatureObject = (
  entityType: string,
  entity: Record<string, unknown>,
): EntitySignatureObject | null => {
  // Include 'state' and all 'state_*' fields
  const stateFields: Record<string, unknown> = {};

  // Main state field
  const stateSignature = buildSchemaSignature(entity.state) as Record<string, unknown> | null;
  if (stateSignature) {
    stateFields['state'] = stateSignature;
  }

  // Additional state_* fields (e.g., state_temperature_current, state_off, state_heat)
  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith('state_')) continue;
    const fieldSignature = buildSchemaSignature(value);
    if (fieldSignature !== null) {
      stateFields[key] = fieldSignature;
    }
  }

  const commands: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(entity)) {
    if (!key.startsWith('command_')) continue;
    const commandSignature = buildSchemaSignature(value) as Record<string, unknown> | null;
    if (commandSignature) {
      commands[key] = commandSignature;
    }
  }

  if (Object.keys(stateFields).length === 0 && Object.keys(commands).length === 0) {
    return null;
  }

  return {
    entityType,
    state: Object.keys(stateFields).length > 0 ? stateFields : null,
    commands: Object.keys(commands).length > 0 ? commands : null,
  };
};

/**
 * Calculate similarity between two values (0~1)
 * Handles arrays with partial matching
 */
const calculateValueSimilarity = (valueA: unknown, valueB: unknown): number => {
  // Both null/undefined
  if (valueA == null && valueB == null) return 1;
  // One is null/undefined
  if (valueA == null || valueB == null) return 0;

  // Both are arrays - calculate partial match
  if (Array.isArray(valueA) && Array.isArray(valueB)) {
    const arrA = valueA as unknown[];
    const arrB = valueB as unknown[];

    if (arrA.length === 0 && arrB.length === 0) return 1;
    if (arrA.length === 0 || arrB.length === 0) return 0;

    // Count matching elements at same positions
    const maxLen = Math.max(arrA.length, arrB.length);
    const minLen = Math.min(arrA.length, arrB.length);
    let matchCount = 0;

    for (let i = 0; i < minLen; i++) {
      if (JSON.stringify(sortKeys(arrA[i])) === JSON.stringify(sortKeys(arrB[i]))) {
        matchCount++;
      }
    }

    // Partial match: matched elements / max length
    return matchCount / maxLen;
  }

  // Both are objects - recursive comparison
  if (typeof valueA === 'object' && typeof valueB === 'object') {
    const objA = valueA as Record<string, unknown>;
    const objB = valueB as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);

    if (allKeys.size === 0) return 1;

    let totalSimilarity = 0;
    for (const key of allKeys) {
      totalSimilarity += calculateValueSimilarity(objA[key], objB[key]);
    }

    return totalSimilarity / allKeys.size;
  }

  // Primitives - exact match
  return JSON.stringify(sortKeys(valueA)) === JSON.stringify(sortKeys(valueB)) ? 1 : 0;
};

/**
 * Calculate similarity between two schema field objects (0~1)
 */
const calculateSchemaFieldSimilarity = (
  schemaA: Record<string, unknown> | null,
  schemaB: Record<string, unknown> | null,
): number => {
  if (schemaA === null && schemaB === null) return 1;
  if (schemaA === null || schemaB === null) return 0;

  const allFields = new Set([...Object.keys(schemaA), ...Object.keys(schemaB)]);
  if (allFields.size === 0) return 1;

  let totalSimilarity = 0;
  for (const field of allFields) {
    const valueA = schemaA[field];
    const valueB = schemaB[field];
    totalSimilarity += calculateValueSimilarity(valueA, valueB);
  }

  return totalSimilarity / allFields.size;
};

/**
 * Calculate similarity between two entity signatures (0~1)
 * Returns 0 if entityType differs
 */
export const calculateSignatureSimilarity = (
  sigA: EntitySignatureObject,
  sigB: EntitySignatureObject,
): number => {
  // Entity type must match
  if (sigA.entityType !== sigB.entityType) {
    return 0;
  }

  // State similarity (weight: 50%)
  const stateSimilarity = calculateSchemaFieldSimilarity(sigA.state, sigB.state);

  // Commands similarity (weight: 50%)
  const commandsA = sigA.commands || {};
  const commandsB = sigB.commands || {};
  const allCommandKeys = new Set([...Object.keys(commandsA), ...Object.keys(commandsB)]);

  let commandSimilarity = 1;
  if (allCommandKeys.size > 0) {
    let commandMatchSum = 0;
    for (const cmdKey of allCommandKeys) {
      const cmdA = commandsA[cmdKey] || null;
      const cmdB = commandsB[cmdKey] || null;
      commandMatchSum += calculateSchemaFieldSimilarity(cmdA, cmdB);
    }
    commandSimilarity = commandMatchSum / allCommandKeys.size;
  }

  // Weighted average
  return stateSimilarity * 0.5 + commandSimilarity * 0.5;
};

/**
 * Find the best matching entity from existing list based on signature similarity
 * @param entityType Entity type (e.g., 'light', 'switch')
 * @param entity Entity object to match
 * @param existingList List of existing entities to search
 * @param threshold Minimum similarity threshold (default: 0.8)
 * @returns Best match with similarity score, or null if no match above threshold
 */
export const findBestSignatureMatch = (
  entityType: string,
  entity: Record<string, unknown>,
  existingList: Record<string, unknown>[],
  threshold = 0.8,
): { match: Record<string, unknown>; matchId: string; similarity: number } | null => {
  const entitySignature = buildEntitySignatureObject(entityType, entity);
  if (!entitySignature) return null;

  let bestMatch: { match: Record<string, unknown>; matchId: string; similarity: number } | null =
    null;

  for (const existing of existingList) {
    if (!existing || typeof existing !== 'object') continue;

    const existingId = (existing as Record<string, unknown>).id;
    if (typeof existingId !== 'string' || existingId.trim().length === 0) continue;

    const existingSignature = buildEntitySignatureObject(entityType, existing);
    if (!existingSignature) continue;

    const similarity = calculateSignatureSimilarity(entitySignature, existingSignature);

    if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
      bestMatch = { match: existing, matchId: existingId, similarity };
    }
  }

  return bestMatch;
};

export interface SignatureMatchCandidate {
  matchId: string;
  similarity: number;
}

/**
 * Find all matching entities from existing list based on signature similarity
 * @param entityType Entity type (e.g., 'light', 'switch')
 * @param entity Entity object to match
 * @param existingList List of existing entities to search
 * @param threshold Minimum similarity threshold (default: 0.8)
 * @returns All matches above threshold, sorted by similarity descending
 */
export const findAllSignatureMatches = (
  entityType: string,
  entity: Record<string, unknown>,
  existingList: Record<string, unknown>[],
  threshold = 0.8,
): SignatureMatchCandidate[] => {
  const entitySignature = buildEntitySignatureObject(entityType, entity);
  if (!entitySignature) return [];

  const matches: SignatureMatchCandidate[] = [];

  for (const existing of existingList) {
    if (!existing || typeof existing !== 'object') continue;

    const existingId = (existing as Record<string, unknown>).id;
    if (typeof existingId !== 'string' || existingId.trim().length === 0) continue;

    const existingSignature = buildEntitySignatureObject(entityType, existing);
    if (!existingSignature) continue;

    const similarity = calculateSignatureSimilarity(entitySignature, existingSignature);

    if (similarity >= threshold) {
      matches.push({ matchId: existingId, similarity });
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);

  return matches;
};

