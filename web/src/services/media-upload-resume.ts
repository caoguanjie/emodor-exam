import type { MediaPurpose } from '../api/media';

export type ResumeRecord = {
  userId: string; sessionId: string; requestId: string; fingerprint: string;
  sizeBytes: number; expiresAt: string; purpose?: MediaPurpose; ownerId?: string;
};
export interface ResumeStore {
  get(userId: string, fingerprint: string): Promise<ResumeRecord | null>;
  put(record: ResumeRecord): Promise<void>;
  remove(userId: string, sessionId: string): Promise<void>;
}
export class MediaResumeStore implements ResumeStore {
  private readonly memory = new Map<string, ResumeRecord>();
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('ruleexam-media-resume', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('uploads', { keyPath: ['userId', 'fingerprint'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = null; reject(new Error('无法打开上传恢复记录')); };
    });
  }

  private valid(value: unknown): ResumeRecord | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as ResumeRecord;
    if (!/^[1-9]\d*$/.test(row.userId) || typeof row.sessionId !== 'string' || row.sessionId.length > 100
      || typeof row.requestId !== 'string' || row.requestId.length > 100 || !/^[a-f0-9]{64}$/.test(row.fingerprint)
      || (row.purpose !== undefined && !['avatar', 'course_cover', 'video', 'question', 'branding'].includes(row.purpose))
      || (row.ownerId !== undefined && (typeof row.ownerId !== 'string' || !/^[1-9]\d{0,19}$/.test(row.ownerId)))
      || !Number.isSafeInteger(row.sizeBytes) || row.sizeBytes < 0 || !Number.isFinite(Date.parse(row.expiresAt))) return null;
    // Copy an explicit allowlist. Caller-owned objects may also contain grants or signed URLs.
    return {
      userId: row.userId, sessionId: row.sessionId, requestId: row.requestId, fingerprint: row.fingerprint,
      sizeBytes: row.sizeBytes, expiresAt: row.expiresAt,
      ...(row.purpose ? { purpose: row.purpose } : {}), ...(row.ownerId ? { ownerId: row.ownerId } : {}),
    };
  }

  async get(userId: string, fingerprint: string): Promise<ResumeRecord | null> {
    let value: unknown;
    if (typeof indexedDB === 'undefined') value = this.memory.get(`${userId}:${fingerprint}`);
    else {
      const db = await this.open();
      value = await new Promise((resolve, reject) => {
        const request = db.transaction('uploads').objectStore('uploads').get([userId, fingerprint]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('无法读取上传恢复记录'));
      });
    }
    const row = this.valid(value);
    if (!row || row.userId !== userId || row.fingerprint !== fingerprint) return null;
    if (Date.parse(row.expiresAt) <= Date.now()) { await this.remove(userId, row.sessionId); return null; }
    return row;
  }

  async put(record: ResumeRecord): Promise<void> {
    const row = this.valid(record);
    if (!row) throw new Error('上传恢复记录无效');
    if (typeof indexedDB === 'undefined') { this.memory.set(`${row.userId}:${row.fingerprint}`, row); return; }
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('uploads', 'readwrite');
      tx.objectStore('uploads').put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('无法保存上传恢复记录'));
      tx.onabort = () => reject(new Error('保存上传恢复记录被中断'));
    });
  }

  async remove(userId: string, sessionId: string): Promise<void> {
    await this.removeMatching(row => row.userId === userId && row.sessionId === sessionId);
  }

  async clearUser(userId: string): Promise<void> { await this.removeMatching(row => row.userId === userId); }

  private async removeMatching(matches: (record: ResumeRecord) => boolean): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      for (const [key, row] of this.memory) if (matches(row)) this.memory.delete(key);
      return;
    }
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('uploads', 'readwrite');
      const cursor = tx.objectStore('uploads').openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const row = this.valid(current.value);
        if (!row || matches(row)) current.delete();
        current.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('无法清除上传恢复记录'));
      tx.onabort = () => reject(new Error('清除上传恢复记录被中断'));
    });
  }
}

export const mediaResumeStore = new MediaResumeStore();
