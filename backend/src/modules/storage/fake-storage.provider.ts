import { StorageProvider, UploadResult } from "./storage.provider.js";

export class FakeStorageProvider implements StorageProvider {
  private files = new Map<string, { buffer: Buffer; mime: string }>();

  async upload(key: string, buffer: Buffer, mime: string): Promise<UploadResult> {
    this.files.set(key, { buffer, mime });
    return {
      key,
      sizeBytes: buffer.length,
      mime,
    };
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const file = this.files.get(key);
    if (!file) {
      return `https://fake-storage.local/${key}?sig=not_found`;
    }
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `https://fake-storage.local/${key}?expires=${expires}&sig=fake_signed_token`;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  getFile(key: string) {
    return this.files.get(key);
  }
}
