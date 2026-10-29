import { Request, Response, NextFunction } from "express";
import { whatsAppService } from "./whatsapp.service.js";
import { ForbiddenError } from "../../lib/errors.js";
import { MetaWebhookPayload } from "./whatsapp.types.js";

export class WhatsAppController {
  /**
   * GET /api/v1/whatsapp/webhook
   * Meta Cloud API Webhook handshake verification
   */
  async handleWebhookGet(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const mode = req.query["hub.mode"] as string | undefined;
      const token = req.query["hub.verify_token"] as string | undefined;
      const challenge = req.query["hub.challenge"] as string | undefined;

      const responseChallenge = whatsAppService.verifyHandshake(mode, token, challenge);
      res.status(200).send(responseChallenge);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/whatsapp/webhook
   * Inbound WhatsApp message and status ingestion with HMAC signature verification
   */
  async handleWebhookPost(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      const isValid = whatsAppService.verifySignature(req.rawBody, signature);

      if (!isValid) {
        throw new ForbiddenError("Invalid WhatsApp webhook HMAC-SHA256 signature");
      }

      const payload = req.body as MetaWebhookPayload;
      const result = await whatsAppService.processWebhook(payload);

      // Meta requires immediate HTTP 200 OK
      res.status(200).json({ status: "ok", ...result });
    } catch (err) {
      next(err);
    }
  }
}

export const whatsAppController = new WhatsAppController();
