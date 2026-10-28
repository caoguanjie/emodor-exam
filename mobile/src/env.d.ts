/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MP_LOCAL_HTTP?: string
  readonly VITE_TEST_LOGIN_ENABLED?: string
  readonly VITE_API_ORIGIN?: string
  readonly VITE_COS_MEDIA_ORIGIN?: string
  readonly VITE_COS_MEDIA_PREFIX?: string
}

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
