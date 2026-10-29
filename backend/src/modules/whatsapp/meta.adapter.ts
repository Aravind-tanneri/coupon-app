import { WhatsAppProvider } from "./whatsapp.provider.js";
import {
  SendTextOptions,
  ButtonItem,
  SendButtonsOptions,
  ListSection,
  SendListOptions,
  SendImageOptions,
  TemplateComponent,
  ProviderSendResult,
  MediaDownloadResult,
} from "./whatsapp.types.js";
import { logger } from "../../config/logger.js";
import { BusinessRuleError, ExternalServiceError } from "../../lib/errors.js";

export interface MetaAdapterConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

export class MetaWhatsAppAdapter implements WhatsAppProvider {
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;

  constructor(config: MetaAdapterConfig) {
    if (!config.phoneNumberId || !config.accessToken) {
      throw new BusinessRuleError(
        "INVALID_CONFIG",
        "Meta WhatsApp adapter requires phoneNumberId and accessToken",
      );
    }
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.apiVersion = config.apiVersion ?? "v21.0";
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  private async postMessages(payload: Record<string, unknown>): Promise<ProviderSendResult> {
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          ...payload,
        }),
      });

      const data = (await response.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message: string; type: string; code: number; error_subcode?: number };
      };

      if (!response.ok || data.error) {
        logger.error({ error: data.error, status: response.status }, "Meta Cloud API send error");
        throw new ExternalServiceError(
          `WhatsApp send failed: ${data.error?.message ?? response.statusText}`,
        );
      }

      const messageId = data.messages?.[0]?.id ?? `wamid.meta.${Date.now()}`;
      return { messageId };
    } catch (err: unknown) {
      if (err instanceof ExternalServiceError) throw err;
      logger.error({ err }, "Network error communicating with Meta Graph API");
      throw new ExternalServiceError(
        `Meta Graph API network failure: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async sendText(to: string, text: string, options?: SendTextOptions): Promise<ProviderSendResult> {
    return this.postMessages({
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: options?.previewUrl ?? false,
        body: text,
      },
    });
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: ButtonItem[],
    options?: SendButtonsOptions,
  ): Promise<ProviderSendResult> {
    const actionButtons = buttons.slice(0, 3).map((b) => ({
      type: "reply",
      reply: {
        id: b.id,
        title: b.title.slice(0, 20),
      },
    }));

    const interactivePayload: Record<string, unknown> = {
      type: "button",
      body: { text: bodyText },
      action: { buttons: actionButtons },
    };

    if (options?.header) {
      interactivePayload.header = { type: "text", text: options.header };
    }
    if (options?.footer) {
      interactivePayload.footer = { text: options.footer };
    }

    return this.postMessages({
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: interactivePayload,
    });
  }

  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
    options?: SendListOptions,
  ): Promise<ProviderSendResult> {
    const formattedSections = sections.map((sec) => ({
      title: sec.title.slice(0, 24),
      rows: sec.rows.slice(0, 10).map((r) => ({
        id: r.id,
        title: r.title.slice(0, 24),
        description: r.description ? r.description.slice(0, 72) : undefined,
      })),
    }));

    const interactivePayload: Record<string, unknown> = {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: formattedSections,
      },
    };

    if (options?.header) {
      interactivePayload.header = { type: "text", text: options.header };
    }
    if (options?.footer) {
      interactivePayload.footer = { text: options.footer };
    }

    return this.postMessages({
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: interactivePayload,
    });
  }

  async sendImage(
    to: string,
    imageUrlOrBuffer: string | Buffer,
    options?: SendImageOptions,
  ): Promise<ProviderSendResult> {
    if (typeof imageUrlOrBuffer !== "string") {
      throw new BusinessRuleError(
        "INVALID_PAYLOAD",
        "Buffer upload must be uploaded to media API before sending",
      );
    }

    return this.postMessages({
      recipient_type: "individual",
      to,
      type: "image",
      image: {
        link: imageUrlOrBuffer,
        caption: options?.caption,
      },
    });
  }

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: TemplateComponent[],
  ): Promise<ProviderSendResult> {
    return this.postMessages({
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components ?? [],
      },
    });
  }

  async downloadMedia(mediaId: string): Promise<MediaDownloadResult> {
    try {
      // Step 1: Retrieve media URL
      const metaUrl = `${this.baseUrl}/${mediaId}`;
      const metaRes = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!metaRes.ok) {
        throw new ExternalServiceError(`Failed to fetch media metadata for ${mediaId}`);
      }

      const metaData = (await metaRes.json()) as { url: string; mime_type: string };
      if (!metaData.url) {
        throw new ExternalServiceError(`Media metadata returned no download URL for ${mediaId}`);
      }

      // Step 2: Download the raw media binary
      const binaryRes = await fetch(metaData.url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!binaryRes.ok) {
        throw new ExternalServiceError(`Failed to download media binary for ${mediaId}`);
      }

      const arrayBuffer = await binaryRes.arrayBuffer();
      return {
        data: Buffer.from(arrayBuffer),
        mimeType: metaData.mime_type || "application/octet-stream",
      };
    } catch (err: unknown) {
      if (err instanceof ExternalServiceError) throw err;
      throw new ExternalServiceError(
        `Media download failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
