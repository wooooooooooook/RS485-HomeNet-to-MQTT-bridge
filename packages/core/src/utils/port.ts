// packages/core/src/utils/port.ts

export const normalizePortId = (portId: string | undefined | null, index: number): string => {
  const trimmed = portId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `homedevice${index + 1}`;
};
