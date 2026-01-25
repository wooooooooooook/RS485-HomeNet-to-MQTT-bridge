export function validateGalleryEntityIds(entities: Record<string, unknown> | undefined): string[] {
  if (!entities) return [];

  const missing: string[] = [];

  for (const [entityType, entityList] of Object.entries(entities)) {
    if (!Array.isArray(entityList)) continue;

    entityList.forEach((entity, index) => {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        missing.push(`${entityType}[${index}]`);
        return;
      }

      const entityId = (entity as Record<string, unknown>).id;
      if (typeof entityId !== 'string' || entityId.trim().length === 0) {
        missing.push(`${entityType}[${index}]`);
      }
    });
  }

  return missing;
}

export function validateGalleryAutomationIds(automation: unknown[] | undefined): string[] {
  return validateIdList(automation, 'automation');
}

export function validateGalleryScriptIds(scripts: unknown[] | undefined): string[] {
  return validateIdList(scripts, 'scripts');
}

function validateIdList(items: unknown[] | undefined, label: string): string[] {
  if (!items) return [];

  const missing: string[] = [];

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      missing.push(`${label}[${index}]`);
      return;
    }

    const itemId = (item as Record<string, unknown>).id;
    if (typeof itemId !== 'string' || itemId.trim().length === 0) {
      missing.push(`${label}[${index}]`);
    }
  });

  return missing;
}
