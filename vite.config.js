// Compatibility entry for a preview already started from the repository root.
import config from './apps/fds-web/vite.config.js'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('./apps/fds-web/',import.meta.url))
export default {...config,root,envDir:root}
