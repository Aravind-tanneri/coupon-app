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

export interface RecordedMessage {
  id: string;
  to: string;
  type: "text" | "buttons" | "list" | "image" | "template";
  payload: Record<string, unknown>;
  timestamp: Date;
}

export class FakeWhatsAppProvider implements WhatsAppProvider {
  private sentMessages: RecordedMessage[] = [];
  private mediaStore = new Map<string, { data: Buffer; mimeType: string }>();
  private messageCounter = 0;

  async sendText(to: string, text: string, options?: SendTextOptions): Promise<ProviderSendResult> {
    const messageId = `wamid.fake.${++this.messageCounter}`;
    this.sentMessages.push({
      id: messageId,
      to,
      type: "text",
      payload: { text, options },
      timestamp: new Date(),
    });
    return { messageId };
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: ButtonItem[],
    options?: SendButtonsOptions,
  ): Promise<ProviderSendResult> {
    const messageId = `wamid.fake.${++this.messageCounter}`;
    this.sentMessages.push({
      id: messageId,
      to,
      type: "buttons",
      payload: { bodyText, buttons, options },
      timestamp: new Date(),
    });
    return { messageId };
  }

  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
    options?: SendListOptions,
  ): Promise<ProviderSendResult> {
    const messageId = `wamid.fake.${++this.messageCounter}`;
    this.sentMessages.push({
      id: messageId,
      to,
      type: "list",
      payload: { bodyText, buttonText, sections, options },
      timestamp: new Date(),
    });
    return { messageId };
  }

  async sendImage(
    to: string,
    imageUrlOrBuffer: string | Buffer,
    options?: SendImageOptions,
  ): Promise<ProviderSendResult> {
    const messageId = `wamid.fake.${++this.messageCounter}`;
    this.sentMessages.push({
      id: messageId,
      to,
      type: "image",
      payload: {
        image: typeof imageUrlOrBuffer === "string" ? imageUrlOrBuffer : "[Buffer]",
        options,
      },
      timestamp: new Date(),
    });
    return { messageId };
  }

  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: TemplateComponent[],
  ): Promise<ProviderSendResult> {
    const messageId = `wamid.fake.${++this.messageCounter}`;
    this.sentMessages.push({
      id: messageId,
      to,
      type: "template",
      payload: { templateName, languageCode, components },
      timestamp: new Date(),
    });
    return { messageId };
  }

  async downloadMedia(mediaId: string): Promise<MediaDownloadResult> {
    const item = this.mediaStore.get(mediaId);
    if (!item) {
      // Default fallback dummy data if not explicitly set
      return {
        data: Buffer.from("%PDF-1.4 mock document data", "utf-8"),
        mimeType: "application/pdf",
      };
    }
    return item;
  }

  // Test inspection utilities
  setMedia(mediaId: string, data: Buffer, mimeType: string): void {
    this.mediaStore.set(mediaId, { data, mimeType });
  }

  getSentMessages(): RecordedMessage[] {
    return [...this.sentMessages];
  }

  getLastMessage(): RecordedMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getMessagesTo(to: string): RecordedMessage[] {
    return this.sentMessages.filter((m) => m.to === to);
  }

  clear(): void {
    this.sentMessages = [];
    this.mediaStore.clear();
    this.messageCounter = 0;
  }
}
