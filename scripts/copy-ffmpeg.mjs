import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const stTargetDir = join(rootDir, 'public', 'ffmpeg');
const mtTargetDir = join(rootDir, 'public', 'ffmpeg-mt');

const ffmpegEsmDir = join(rootDir, 'node_modules', '@ffmpeg', 'ffmpeg', 'dist', 'esm');
const coreStEsmDir = join(rootDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const coreMtEsmDir = join(rootDir, 'node_modules', '@ffmpeg', 'core-mt', 'dist', 'esm');

if (!existsSync(ffmpegEsmDir) || !existsSync(coreStEsmDir)) {
  console.warn('[copy-ffmpeg] FFmpeg packages not found yet; skipping copy.');
  process.exit(0);
}

mkdirSync(stTargetDir, { recursive: true });

// Copy ESM worker and all supporting relative JS modules from @ffmpeg/ffmpeg/dist/esm
for (const entry of readdirSync(ffmpegEsmDir, { withFileTypes: true })) {
  if (entry.isFile() && /\.(m?js)$/i.test(entry.name)) {
    copyFileSync(join(ffmpegEsmDir, entry.name), join(stTargetDir, entry.name));
  }
}

// Copy single-threaded core JS + WASM from @ffmpeg/core/dist/esm
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const src = join(coreStEsmDir, file);
  if (existsSync(src)) {
    copyFileSync(src, join(stTargetDir, file));
  } else {
    throw new Error(`[copy-ffmpeg] Missing required FFmpeg ST core file: ${src}`);
  }
}

// Copy multi-threaded core JS + WASM + Worker from @ffmpeg/core-mt/dist/esm
if (existsSync(coreMtEsmDir)) {
  mkdirSync(mtTargetDir, { recursive: true });
  for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js']) {
    const src = join(coreMtEsmDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(mtTargetDir, file));
    } else {
      throw new Error(`[copy-ffmpeg] Missing required FFmpeg MT core file: ${src}`);
    }
  }
  console.log('[copy-ffmpeg] Copied FFmpeg ST -> public/ffmpeg/ and MT -> public/ffmpeg-mt/');
} else {
  console.log('[copy-ffmpeg] Copied FFmpeg ST -> public/ffmpeg/ (@ffmpeg/core-mt not installed)');
}
