export function validateGalleryEntityIds(
  entities: Record<string, unknown> | undefined,
): string[] {
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
