import { Router } from "express";
import { menuController } from "./menu.controller.js";
import { requireAuth } from "../../middleware/session.js";
import { requirePermission } from "../../middleware/permissions.js";

export const menuRouter = Router();

menuRouter.use(requireAuth);

menuRouter.get("/", requirePermission("menu:view"), (req, res, next) => {
  menuController.getMenuRange(req, res).catch(next);
});

menuRouter.get("/today", requirePermission("menu:view"), (req, res, next) => {
  menuController.getTodayMenu(req, res).catch(next);
});

menuRouter.post("/slot", requirePermission("menu:edit"), (req, res, next) => {
  menuController.upsertSlot(req, res).catch(next);
});

menuRouter.post("/copy-week", requirePermission("menu:edit"), (req, res, next) => {
  menuController.copyWeek(req, res).catch(next);
});
