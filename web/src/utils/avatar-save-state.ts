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

export interface StudentSaveContext {
  dialogVersion: number;
  studentId: string | null;
  desiredId: string | null;
  ordinary: Record<string, unknown>;
}

export interface StudentSaveWorkflowOptions {
  avatarChanged: boolean;
  read: (path: string) => Promise<unknown>;
  currentContext: () => StudentSaveContext | null;
  writeOrdinary: (draft: Record<string, unknown>) => Promise<void>;
  writeAvatar: (desiredId: string | null) => Promise<void>;
}

export interface StudentSaveWorkflowResult {
  outcome: 'saved' | 'blocked' | 'stale';
  avatarResult?: AvatarReconcileResult;
  error?: unknown;
}

function sameOrdinaryDraft(expected: Record<string, unknown>, current: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(expected), ...Object.keys(current)]);
  return [...keys].every((key) => expected[key] === current[key]);
}

export function isStudentSaveContextCurrent(
  expected: StudentSaveContext,
  current: StudentSaveContext | null,
): boolean {
  return !!current
    && expected.dialogVersion === current.dialogVersion
    && expected.studentId === current.studentId
    && expected.desiredId === current.desiredId
    && sameOrdinaryDraft(expected.ordinary, current.ordinary);
}

/**
 * Execute the complete student save sequence against one frozen dialog
 * context. Every continuation checks the current context before mutating or
 * issuing the next write; a late avatar failure is reconciled against the
 * original student id rather than whichever dialog is currently visible.
 */
export async function runStudentSaveWorkflow(
  status: AvatarSyncStatus,
  context: StudentSaveContext,
  options: StudentSaveWorkflowOptions,
): Promise<StudentSaveWorkflowResult> {
  let avatarChanged = options.avatarChanged;
  let avatarResult: AvatarReconcileResult | undefined;

  if (status === 'unknown' && context.studentId !== null) {
    const preflight = await preflightAvatarSave(
      status,
      {
        dialogVersion: context.dialogVersion,
        studentId: context.studentId,
        desiredId: context.desiredId,
      },
      options.read,
      () => {
        const current = options.currentContext();
        if (!current || current.studentId === null) return null;
        return {
          dialogVersion: current.dialogVersion,
          studentId: current.studentId,
          desiredId: current.desiredId,
        };
      },
    );
    avatarResult = preflight.result || undefined;
    if (preflight.action === 'stale' || !isStudentSaveContextCurrent(context, options.currentContext())) {
      return { outcome: 'stale', avatarResult };
    }
    if (preflight.action === 'blocked') return { outcome: 'blocked', avatarResult };
    // The avatar is already confirmed by the query. The ordinary draft still
    // needs its own PUT and must not be discarded by closing the dialog here.
    avatarChanged = false;
  }

  await options.writeOrdinary(context.ordinary);
  if (!isStudentSaveContextCurrent(context, options.currentContext())) return { outcome: 'stale', avatarResult };

  if (avatarChanged) {
    try {
      await options.writeAvatar(context.desiredId);
    } catch (error) {
      // Even when the dialog has switched, reconcile the original student;
      // apply the result only if the original context is still current.
      const reconciled = context.studentId === null
        ? unknownResult(context.desiredId)
        : await reconcileStudentAvatar(context.studentId, context.desiredId, options.read);
      if (!isStudentSaveContextCurrent(context, options.currentContext())) {
        return { outcome: 'stale', avatarResult: reconciled };
      }
      if (reconciled.outcome === 'applied') return { outcome: 'saved', avatarResult: reconciled };
      return { outcome: 'blocked', avatarResult: reconciled, error };
    }
    if (!isStudentSaveContextCurrent(context, options.currentContext())) return { outcome: 'stale', avatarResult };
  }
  return { outcome: 'saved', avatarResult };
}
