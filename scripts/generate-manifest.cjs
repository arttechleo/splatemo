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

// Validate PLY file: check size and header
const validatePlyFile = (filePath) => {
  try {
    const stats = fs.statSync(filePath)
    if (stats.size < 1024) {
      throw new Error(`File ${path.basename(filePath)} is too small (${stats.size} bytes) - likely LFS pointer or invalid file`)
    }
    
    // Check file header (first 10 bytes should contain 'ply')
    const header = fs.readFileSync(filePath, { encoding: 'utf8', end: 10 })
    if (!header.toLowerCase().includes('ply')) {
      throw new Error(`File ${path.basename(filePath)} does not appear to be a valid PLY file (header: ${header})`)
    }
    
    return true
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`)
    }
    throw error
  }
}

// Check for CDN URL environment variable (for production)
// If not set, use relative path for dev/local
const CDN_BASE_URL = process.env.CDN_BASE_URL || null

const entries = fs
  .readdirSync(splatsDir)
  .filter((file) => file.toLowerCase().endsWith('.ply'))
  .map((file) => {
    const filePath = path.join(splatsDir, file)
    
    // Validate file before adding to manifest
    validatePlyFile(filePath)
    
    const id = path.basename(file, path.extname(file))
    // Always generate url field: use CDN if set, otherwise relative path
    // Relative paths will be resolved with BASE_URL in resolveSplatUrl()
    const url = CDN_BASE_URL 
      ? `${CDN_BASE_URL}/splats/${file}` // Production: absolute CDN URL
      : `/splats/${file}` // Dev/local: absolute path from root (will work with BASE_URL)
    
    return {
      id,
      name: toTitle(file),
      file,
      url, // url is always present
    }
  })

// Validate all entries have required fields
entries.forEach((entry) => {
  if (!entry.id || !entry.file || !entry.url) {
    throw new Error(`Invalid manifest entry: missing required fields (id: ${entry.id}, file: ${entry.file}, url: ${entry.url})`)
  }
})

fs.writeFileSync(manifestPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8')
console.log(`✓ Wrote ${entries.length} entries to public/splats/manifest.json`)
console.log(`✓ All entries validated (id, name, file, url)`)
console.log(`✓ URL mode: ${CDN_BASE_URL ? `CDN (${CDN_BASE_URL})` : 'relative (/splats/...)'}`)
