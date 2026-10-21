export interface LatestRequestTicket {
  signal: AbortSignal;
  isCurrent: () => boolean;
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

  return {
    begin(): LatestRequestTicket {
      controller?.abort();
      controller = new AbortController();
      const requestGeneration = ++generation;
      if (!active) controller.abort();
      return {
        signal: controller.signal,
        isCurrent: () => active && requestGeneration === generation,
      };
    },
    stop(): void {
      active = false;
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}
