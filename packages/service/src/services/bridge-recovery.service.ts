import { normalizePortId } from '@rs485-homenet/core';
import type { AutoRestartFault } from './auto-restart.service.js';
import type { BridgeInstance, BridgeErrorPayload, ConfigStatus } from '../types/index.js';
import { mapBridgeStartError } from '../utils/bridge-errors.js';

export interface BridgeRecoveryContext {
  getBridges: () => BridgeInstance[];
  getCurrentConfigFiles: () => string[];
  getCurrentConfigStatuses: () => ConfigStatus[];
  getCurrentConfigErrors: () => (BridgeErrorPayload | null)[];
  setCurrentConfigStatus: (index: number, status: ConfigStatus) => void;
  setCurrentConfigError: (index: number, error: BridgeErrorPayload | null) => void;
  isAutoRestartSuppressed: () => boolean;
  isBridgeStarting: () => boolean;
  emitBridgeStatus: (payload: {
    portId: string;
    status: string;
    errorInfo?: BridgeErrorPayload | null;
  }) => void;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

export function createBridgeRecoveryHandler(ctx: BridgeRecoveryContext) {
  const inFlightRecoveries = new Map<string, Promise<boolean>>();

  const recoverBridgeFault = async (fault: AutoRestartFault): Promise<boolean> => {
    const portId = fault.portId;
    if (!portId) {
      return false;
    }

    if (ctx.isAutoRestartSuppressed() || ctx.isBridgeStarting()) {
      ctx.logger.info(
        { portId },
        '[service] Bridge recovery skipped because bridge startup/shutdown is in progress',
      );
      return false;
    }

    const existingPromise = inFlightRecoveries.get(portId);
    if (existingPromise) {
      ctx.logger.info({ portId }, '[service] Bridge recovery already in flight for portId');
      return existingPromise;
    }

    const recoveryPromise = (async () => {
      ctx.logger.warn({ portId }, '[service] Restarting affected bridge after persistent fault');

      const bridges = ctx.getBridges();
      const instance = bridges.find((b) => {
        const pId = normalizePortId(b.config.serial?.portId ?? 'unknown', 0);
        return pId === portId;
      });

      if (!instance) {
        ctx.logger.error(
          { portId },
          '[service] Failed to restart affected bridge: bridge instance not found',
        );
        return false;
      }

      const currentConfigFiles = ctx.getCurrentConfigFiles();
      const originalIndex = currentConfigFiles.indexOf(instance.configFile);
      if (originalIndex !== -1) {
        ctx.setCurrentConfigStatus(originalIndex, 'starting');
        ctx.setCurrentConfigError(originalIndex, null);
      }

      try {
        await instance.bridge.stop();
        await instance.bridge.start();

        if (originalIndex !== -1) {
          ctx.setCurrentConfigStatus(originalIndex, 'started');
          ctx.setCurrentConfigError(originalIndex, null);
        }
        ctx.emitBridgeStatus({
          portId,
          status: 'started',
        });
        ctx.logger.info({ portId }, '[service] Affected bridge restarted successfully');
        return true;
      } catch (err) {
        ctx.logger.error({ err, portId }, '[service] Failed to restart affected bridge');
        let errorPayload: BridgeErrorPayload | null = null;
        if (originalIndex !== -1) {
          errorPayload = mapBridgeStartError(err, portId);
          ctx.setCurrentConfigStatus(originalIndex, 'error');
          ctx.setCurrentConfigError(originalIndex, errorPayload);
        }
        ctx.emitBridgeStatus({
          portId,
          status: 'error',
          errorInfo: errorPayload,
        });
        return false;
      } finally {
        inFlightRecoveries.delete(portId);
      }
    })();

    inFlightRecoveries.set(portId, recoveryPromise);
    return recoveryPromise;
  };

  return {
    recoverBridgeFault,
    getInFlightRecoveries: () => inFlightRecoveries,
  };
}
