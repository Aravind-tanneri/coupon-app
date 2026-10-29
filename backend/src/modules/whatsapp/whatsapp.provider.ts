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

export interface WhatsAppProvider {
  sendText(to: string, text: string, options?: SendTextOptions): Promise<ProviderSendResult>;

  sendButtons(
    to: string,
    bodyText: string,
    buttons: ButtonItem[],
    options?: SendButtonsOptions,
  ): Promise<ProviderSendResult>;

  sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
    options?: SendListOptions,
  ): Promise<ProviderSendResult>;

  sendImage(
    to: string,
    imageUrlOrBuffer: string | Buffer,
    options?: SendImageOptions,
  ): Promise<ProviderSendResult>;

  sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: TemplateComponent[],
  ): Promise<ProviderSendResult>;

  downloadMedia(mediaId: string): Promise<MediaDownloadResult>;
}
