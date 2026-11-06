import * as mock from './mock'
import * as server from './client'

// VITE_API=mock keeps the static demo working without a server.
export const api = import.meta.env.VITE_API === 'mock' ? mock : server
