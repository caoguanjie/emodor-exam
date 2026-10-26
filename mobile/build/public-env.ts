/** Public root defaults must not override this client's existing mode files. */
export function publicEnvFallbackDefines(
  root: Record<string, string | undefined>,
  client: Record<string, string | undefined>,
  runtime: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(root)
    .filter(([key, value]) => key.startsWith('VITE_') && value !== undefined && client[key] === undefined && runtime[key] === undefined)
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]))
}
