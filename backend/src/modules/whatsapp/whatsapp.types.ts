export interface SendTextOptions {
  previewUrl?: boolean;
}

export interface ButtonItem {
  id: string;
  title: string;
}

export interface SendButtonsOptions {
  header?: string;
  footer?: string;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface SendListOptions {
  header?: string;
  footer?: string;
}

export interface SendImageOptions {
  caption?: string;
}

export interface TemplateComponent {
  type: "header" | "body" | "button";
  sub_type?: "quick_reply" | "url";
  index?: number;
  parameters: Array<{
    type: "text" | "currency" | "date_time" | "image" | "payload";
    text?: string;
    payload?: string;
    [key: string]: unknown;
  }>;
}

export interface SendTemplateOptions {
  components?: TemplateComponent[];
}

export interface ProviderSendResult {
  messageId: string;
}

export interface MediaDownloadResult {
  data: Buffer;
  mimeType: string;
}

// Meta Webhook Inbound Types
export interface MetaWebhookPayload {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: "text" | "interactive" | "image" | "document" | "button" | string;
          text?: {
            body: string;
          };
          interactive?: {
            type: "button_reply" | "list_reply";
            button_reply?: {
              id: string;
              title: string;
            };
            list_reply?: {
              id: string;
              title: string;
              description?: string;
            };
          };
          button?: {
            text: string;
            payload?: string;
          };
          image?: {
            id: string;
            mime_type: string;
            sha256?: string;
            caption?: string;
          };
          document?: {
            id: string;
            filename: string;
            mime_type: string;
            sha256?: string;
          };
        }>;
        statuses?: Array<{
          id: string;
          status: "sent" | "delivered" | "read" | "failed";
          timestamp: string;
          recipient_id: string;
          errors?: Array<{
            code: number;
            title: string;
            message?: string;
          }>;
        }>;
      };
      field: string;
    }>;
  }>;
}
