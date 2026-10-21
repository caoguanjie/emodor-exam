export interface LatestRequestTicket {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
}

/**
 * One active request per view. Starting a newer request cancels the previous
 * transport, while the generation check also blocks late responses from
 * clients or intermediaries that do not honor AbortSignal promptly.
 */
export function createLatestRequestScope() {
  let generation = 0;
  let active = true;
  let controller: AbortController | null = null;

  function begin(): LatestRequestTicket {
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const requestGeneration = ++generation;
    if (!active) controller.abort();
    return {
      signal: requestController.signal,
      isCurrent: () => active && requestGeneration === generation,
      finish: () => {
        if (requestGeneration === generation && controller === requestController) controller = null;
      },
    };
  }

  return {
    begin,
    beginIfIdle(): LatestRequestTicket | null {
      return controller ? null : begin();
    },
    stop(): void {
      active = false;
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}
