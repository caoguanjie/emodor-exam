import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { IdentityProvider, IdentityProviderInput, IdentityProviderResult } from '../../src/modules/identity/identity-provider';

/** Only injected by identity-e2e-main.ts. No production module imports this file. */
export class FakeIdentityProvider implements IdentityProvider {
  readonly enabled = true;
  private calls = 0;
  private paused = false;
  private readonly waiting = new Set<() => void>();
  snapshot() { return { verify_calls: this.calls, paused: this.paused, waiting_calls: this.waiting.size }; }
  pause() { this.paused = true; }
  resume() { this.paused = false; for (const finish of [...this.waiting]) finish(); }
  async cropDocument(bytes: Buffer): Promise<Buffer> { return bytes; }
  async verify(input: IdentityProviderInput): Promise<IdentityProviderResult> {
    this.calls++;
    const callNumber = this.calls;
    if (this.paused) {
      await new Promise<void>((resolve) => {
        const finish = () => { clearTimeout(timeout); this.waiting.delete(finish); resolve(); };
        const timeout = setTimeout(finish, 15_000);
        this.waiting.add(finish);
      });
    }
    const pixel = await sharp(input.face).resize(1, 1).removeAlpha().raw().toBuffer();
    const requestId = `synthetic-provider-${callNumber}`;
    if (pixel[0] > 200 && pixel[1] < 80) return { status: 'rejected', reasonCode: 'FACE_MISMATCH', providerRequestId: requestId };
    return { status: 'verified', realName: '合成测试主体', idNumber: `SYNTHETIC-${createHash('sha256').update(input.portrait).digest('hex').slice(0, 20)}`, providerRequestId: requestId };
  }
}
