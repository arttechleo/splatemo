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

// Check for CDN URL environment variable (for production)
// If not set, use relative path for dev/local
const CDN_BASE_URL = process.env.CDN_BASE_URL || null

const entries = fs
  .readdirSync(splatsDir)
  .filter((file) => file.toLowerCase().endsWith('.ply'))
  .map((file) => {
    const id = path.basename(file, path.extname(file))
    const url = CDN_BASE_URL 
      ? `${CDN_BASE_URL}/splats/${file}` // Production: absolute CDN URL
      : `splats/${file}` // Dev: relative path (will be resolved with BASE_URL)
    
    return {
      id,
      name: toTitle(file),
      file,
      url,
    }
  })

fs.writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8')
console.log(`Wrote ${entries.length} entries to public/splats/manifest.json`)
console.log(`URL mode: ${CDN_BASE_URL ? `CDN (${CDN_BASE_URL})` : 'relative (dev)'}`)
