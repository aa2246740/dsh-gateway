import { externalClientBundle } from '../../tools/dshx/src/client-build.js'

export default externalClientBundle('dsh-messaging-gateway', ['lib/types/dsh-messaging-gateway.js'], {
  clientEntry: 'src/client/index.tsx',
})
