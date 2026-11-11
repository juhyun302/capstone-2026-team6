import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `--mode single` (npm run build:single) builds one JS file and one CSS file with every
// font inlined; scripts/inline-single-file.mjs then folds them into one HTML file.
// `--mode web` (npm run build:web) builds dist-web for the Cloudflare worker (wrangler.jsonc).
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    // VITE_BASE=./ for a relative bundle (artifact or any sub-path host)
    base: single ? './' : (process.env.VITE_BASE ?? '/'),
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': 'http://127.0.0.1:8000' },
      // the browser pipeline imports prompts and schemas from ../src/aleph
      fs: { allow: ['..'] },
    },
    preview: { proxy: { '/api': 'http://127.0.0.1:8000' } },
    build: {
      outDir: single ? 'dist-single' : mode === 'web' ? 'dist-web' : 'dist',
      chunkSizeWarningLimit: single ? 4000 : 1200,
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : undefined,
      cssCodeSplit: !single,
      rollupOptions: {
        // stable names, so a static host or artifact file list does not change per build
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
          ...(single ? { inlineDynamicImports: true } : {}),
        },
      },
    },
  }
})
