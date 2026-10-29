export interface UploadResult {
  key: string;
  sizeBytes: number;
  mime: string;
}

export interface StorageProvider {
  upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
