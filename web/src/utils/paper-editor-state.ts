function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolvePaperSaveCompletion<T>(input: {
  current: T;
  previousBaseline: T;
  previousAppliedOperation: number;
  submitted: T;
  operation: number;
}): { current: T; baseline: T; dirty: boolean; appliedOperation: number } {
  const current = clone(input.current);
  if (input.operation <= input.previousAppliedOperation) {
    const baseline = clone(input.previousBaseline);
    return { current, baseline, dirty: !equal(current, baseline), appliedOperation: input.previousAppliedOperation };
  }
  const baseline = clone(input.submitted);
  return { current, baseline, dirty: !equal(current, baseline), appliedOperation: input.operation };
}
