import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'ogg', 'wav'])

function soundsManifestPlugin(): Plugin {
  const outPath = path.resolve(__dirname, 'public/sounds/manifest.json')

  function buildManifest() {
    const dir = path.resolve(__dirname, 'public/sounds')
    const manifest: Record<string, string> = {}
    for (const name of fs.readdirSync(dir)) {
      const dot = name.lastIndexOf('.')
      if (dot === -1) continue
      const ext = name.slice(dot + 1).toLowerCase()
      if (AUDIO_EXTS.has(ext)) manifest[name.slice(0, dot)] = ext
    }
    fs.writeFileSync(outPath, JSON.stringify(manifest))
  }

  return {
    name: 'sounds-manifest',
    buildStart: buildManifest,
    configureServer(server) {
      buildManifest()
      server.watcher.on('add', f => { if (f.startsWith(path.resolve(__dirname, 'public/sounds'))) buildManifest() })
      server.watcher.on('unlink', f => { if (f.startsWith(path.resolve(__dirname, 'public/sounds'))) buildManifest() })
    },
  }
}

export default defineConfig({
  base: '/pavlov-cat/',
  plugins: [soundsManifestPlugin()],
})
