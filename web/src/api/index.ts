import * as mock from './mock'
import * as server from './client'
import * as browser from './browser'

// VITE_API=mock keeps the static demo working without a server.
// VITE_API=browser runs the pipeline in this browser with the viewer's own OpenAI key.
export const apiMode = import.meta.env.VITE_API === 'mock' ? 'mock' : import.meta.env.VITE_API === 'browser' ? 'browser' : 'server'
export const api = apiMode === 'mock' ? mock : apiMode === 'browser' ? browser : server
