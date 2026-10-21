export type AvatarReconcileOutcome = 'applied' | 'not_applied' | 'unknown';
export type AvatarSyncStatus = 'idle' | 'pending' | 'confirmed' | 'not_applied' | 'unknown';

export interface AvatarReconcileResult {
  outcome: AvatarReconcileOutcome;
  confirmedId: string | null;
  pendingId: string | null;
  message: string;
}

export interface AvatarReconcileContext {
  dialogVersion: number;
  studentId: string;
  desiredId: string | null;
}

export type AvatarSavePreflightAction = 'write' | 'confirmed' | 'blocked' | 'stale';

export interface AvatarSavePreflightResult {
  action: AvatarSavePreflightAction;
  result: AvatarReconcileResult | null;
}

export function normalizeAvatarId(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const id = String(value).trim();
  return id || null;
}

function unknownResult(desiredId: string | null): AvatarReconcileResult {
  return {
    outcome: 'unknown',
    confirmedId: null,
    pendingId: desiredId,
    message: '头像状态暂无法确认，请查询状态或稍后重试',
  };
}

/** Classify one authoritative student detail response without mutating UI state. */
export function classifyAvatarRead(
  desiredId: string | null,
  response: unknown,
): AvatarReconcileResult {
  if (!response || typeof response !== 'object' || !Object.prototype.hasOwnProperty.call(response, 'avatar_id')) {
    return unknownResult(desiredId);
  }
  const rawAvatarId = (response as { avatar_id?: unknown }).avatar_id;
  if (rawAvatarId === undefined) return unknownResult(desiredId);
  const observedId = normalizeAvatarId(rawAvatarId);
  if (observedId === desiredId) {
    return {
      outcome: 'applied',
      confirmedId: observedId,
      pendingId: null,
      message: '头像已确认更新',
    };
  }
  return {
    outcome: 'not_applied',
    confirmedId: observedId,
    pendingId: desiredId,
    message: observedId
      ? '服务器确认目标头像尚未应用，当前仍是其他头像；可点击保存重试'
      : '服务器确认目标头像尚未应用，当前未设置头像；可点击保存重试',
  };
}

/**
 * Reconcile an uncertain avatar write through the exact student detail route.
 * Read failures deliberately remain unknown; the pending asset id is retained.
 */
export async function reconcileStudentAvatar(
  studentId: string | number,
  desiredId: string | null,
  read: (path: string) => Promise<unknown>,
): Promise<AvatarReconcileResult> {
  const path = `/admin/students/${encodeURIComponent(String(studentId))}`;
  try {
    return classifyAvatarRead(desiredId, await read(path));
  } catch {
    return unknownResult(desiredId);
  }
}

export function isAvatarReconcileContextCurrent(
  expected: AvatarReconcileContext,
  current: AvatarReconcileContext | null,
): boolean {
  return !!current
    && expected.dialogVersion === current.dialogVersion
    && expected.studentId === current.studentId
    && expected.desiredId === current.desiredId;
}

/**
 * Gate an avatar save after an uncertain result. Unknown state must be read
 * first; only a later explicit save, after a confirmed non-unknown result,
 * may return `write`. The context callback prevents a late response from
 * mutating a dialog that was cancelled and replaced.
 */
export async function preflightAvatarSave(
  status: AvatarSyncStatus,
  context: AvatarReconcileContext,
  read: (path: string) => Promise<unknown>,
  currentContext: () => AvatarReconcileContext | null,
): Promise<AvatarSavePreflightResult> {
  if (status !== 'unknown') return { action: 'write', result: null };
  const result = await reconcileStudentAvatar(context.studentId, context.desiredId, read);
  if (!isAvatarReconcileContextCurrent(context, currentContext())) {
    return { action: 'stale', result };
  }
  return result.outcome === 'applied'
    ? { action: 'confirmed', result }
    : { action: 'blocked', result };
}
