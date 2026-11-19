import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const targetDir = join(rootDir, 'public', 'ffmpeg');

const ffmpegEsmDir = join(rootDir, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
const coreEsmDir = join(rootDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');

if (!existsSync(ffmpegEsmDir) || !existsSync(coreEsmDir)) {
  console.warn('[copy-ffmpeg] FFmpeg packages not found yet; skipping copy.');
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });

// Copy ESM worker and all supporting relative JS modules from @ffmpeg/ffmpeg/dist/esm
for (const entry of readdirSync(ffmpegEsmDir, { withFileTypes: true })) {
  if (entry.isFile() && /\.(m?js)$/i.test(entry.name)) {
    copyFileSync(join(ffmpegEsmDir, entry.name), join(targetDir, entry.name));
  }
}

// Copy core JS + WASM from @ffmpeg/core/dist/esm
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const src = join(coreEsmDir, file);
  if (existsSync(src)) {
    copyFileSync(src, join(targetDir, file));
  } else {
    throw new Error(`[copy-ffmpeg] Missing required FFmpeg core file: ${src}`);
  }
}

console.log('[copy-ffmpeg] Copied FFmpeg ESM worker and core assets to public/ffmpeg/');
