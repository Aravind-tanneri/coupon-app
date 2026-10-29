import { Router } from "express";
import { whatsAppController } from "./whatsapp.controller.js";

export const whatsAppRouter = Router();

whatsAppRouter.get("/webhook", (req, res, next) => {
  whatsAppController.handleWebhookGet(req, res, next);
});

whatsAppRouter.post("/webhook", (req, res, next) => {
  whatsAppController.handleWebhookPost(req, res, next);
});
