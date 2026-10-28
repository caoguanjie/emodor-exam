/** Both switches are required; production builds never expose test login. */
export function isTestLoginEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_TEST_LOGIN_ENABLED === 'true'
}
