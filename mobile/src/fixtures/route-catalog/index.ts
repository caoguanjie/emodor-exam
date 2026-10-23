import { shellRouteCatalog } from './shell'
import { identityRouteCatalog } from './identity'
import { examRouteCatalog } from './exam'

export * from './shell'
export * from './identity'
export * from './exam'

export const routeCatalog = [
  ...shellRouteCatalog,
  ...identityRouteCatalog,
  ...examRouteCatalog,
]
