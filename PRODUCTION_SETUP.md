# Production Setup - CDN Configuration

## Overview

PLY files are now loaded from external CDN URLs in production to avoid Git LFS checkout issues during deployment.

## Manifest Format

The `public/splats/manifest.json` file now includes a `url` field for each splat entry:

```json
{
  "id": "abstractphotography",
  "name": "Abstract Photography",
  "file": "abstractphotography.ply",
  "url": "https://your-cdn.com/splats/abstractphotography.ply"
}
```

## Setting Up CDN URLs for Production

### Option 1: Update Manifest with CDN URLs

1. Upload all `.ply` files from `public/splats/` to your CDN (R2/S3/B2/GitHub Releases)
2. Update `public/splats/manifest.json` with absolute HTTPS URLs:

```json
{
  "id": "abstractphotography",
  "url": "https://your-cdn.example.com/splats/abstractphotography.ply"
}
```

### Option 2: Use Environment Variable During Build

1. Set `CDN_BASE_URL` environment variable during build:
   ```bash
   CDN_BASE_URL=https://your-cdn.example.com npm run generate:manifest
   ```

2. This will auto-generate manifest with CDN URLs

## Development Mode

For local development, the manifest uses relative paths (`splats/abstractphotography.ply`) which are resolved using `BASE_URL`. No CDN setup needed for dev.

## URL Resolution Logic

The code automatically handles:
- **Absolute URLs** (https://...): Used directly
- **Relative URLs** (splats/...): Resolved with BASE_URL for dev
- **Fallback**: If `url` is missing, constructs path from `file` field

## Removing Git LFS Dependency

The `.gitattributes` file has been updated to stop tracking `.ply` files with Git LFS. This prevents deployment failures when LFS budget is exceeded.

To remove existing LFS tracking:
```bash
git lfs untrack "*.ply"
git add .gitattributes
git commit -m "Stop tracking PLY files with Git LFS"
```

Note: The `.ply` files can remain in `public/splats/` for local dev, but production should use CDN URLs.
