/**
 * Routes index - registers all route modules on the Express app
 */

import type { Express } from 'express';
import { createSystemRoutes, type SystemRoutesContext } from './system.routes.js';
import { createPacketToolsRoutes, type PacketToolsRoutesContext } from './packets.routes.js';
import { createGalleryRoutes, type GalleryRoutesContext } from './gallery.routes.js';
import { createLogsRoutes, type LogsRoutesContext } from './logs.routes.js';
import { createBackupsRoutes, type BackupsRoutesContext } from './backups.routes.js';
import { createEntitiesRoutes, type EntitiesRoutesContext } from './entities.routes.js';
import { createControlsRoutes, type ControlsRoutesContext } from './controls.routes.js';
import { createConfigRoutes, type ConfigRoutesContext } from './config.routes.js';
import { createUtilsRoutes, type UtilsRoutesContext } from './utils.routes.js';
import { createSetupRoutes, type SetupRoutesContext } from './setup.routes.js';
import {
  createConfigEditorRoutes,
  type ConfigEditorRoutesContext,
} from './config-editor.routes.js';

export interface RoutesContext
  extends SystemRoutesContext,
    PacketToolsRoutesContext,
    GalleryRoutesContext,
    LogsRoutesContext,
    BackupsRoutesContext,
    EntitiesRoutesContext,
    EntitiesRoutesContext,
    ControlsRoutesContext,
    ConfigRoutesContext,
    UtilsRoutesContext,
    SetupRoutesContext,
    ConfigEditorRoutesContext {}

export function registerRoutes(app: Express, ctx: RoutesContext): void {
  // System routes (health, restart)
  app.use(createSystemRoutes(ctx));

  // Packet tools routes (preview, send)
  app.use(createPacketToolsRoutes(ctx));

  // Gallery routes (list, file, check-conflicts, apply)
  app.use(createGalleryRoutes(ctx));

  // Logs routes (log-sharing, packet logs, cache)
  app.use(createLogsRoutes(ctx));

  // Backups routes (list, download, delete, cleanup)
  app.use(createBackupsRoutes(ctx));

  // Entities routes (list, get, create, update, delete)
  app.use(createEntitiesRoutes(ctx));

  // Controls routes (commands, automations, scripts)
  app.use(createControlsRoutes(ctx));

  // Config routes (update)
  // Config routes (update)
  app.use(createConfigRoutes(ctx));

  // Utils routes (cel evaluate)
  app.use(createUtilsRoutes(ctx));

  // Setup routes
  app.use(createSetupRoutes(ctx));

  // Config Editor routes
  app.use(createConfigEditorRoutes(ctx));
}

export { createSystemRoutes } from './system.routes.js';
export { createPacketToolsRoutes } from './packets.routes.js';
export { createGalleryRoutes } from './gallery.routes.js';
export { createLogsRoutes } from './logs.routes.js';
export { createBackupsRoutes } from './backups.routes.js';
export { createUtilsRoutes } from './utils.routes.js';
