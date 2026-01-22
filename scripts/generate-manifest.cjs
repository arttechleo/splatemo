const fs = require('fs')
const path = require('path')

const splatsDir = path.join(__dirname, '..', 'public', 'splats')
const manifestPath = path.join(splatsDir, 'manifest.json')

const toTitle = (filename) =>
  filename
    .replace(/\.ply$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())

const entries = fs
  .readdirSync(splatsDir)
  .filter((file) => file.toLowerCase().endsWith('.ply'))
  .map((file) => ({
    id: path.basename(file, path.extname(file)),
    file: `/splats/${file}`,
    user: { handle: '@studio', name: 'Studio', avatar: 'S' },
    caption: toTitle(file),
    counts: { likes: 0, comments: 0, reposts: 0 },
    cameraPoses: [{ name: 'Front', position: [0, 0, 6], target: [0, 0, 0] }],
    annotations: [],
  }))

const manifest = { splats: entries }
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
console.log(`Wrote ${entries.length} entries to public/splats/manifest.json`)
