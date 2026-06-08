/**
 * 下载图片到本地 assets 目录
 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream');
const { promisify } = require('util');
const logger = require('../helpers/logger');
const streamPipeline = promisify(pipeline);

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) return true; // 已存在
  const proto = url.startsWith('https') ? https : http;
  return new Promise((resolve) => {
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve);
      }
      if (res.statusCode !== 200) { resolve(false); return; }
      const file = fs.createWriteStream(destPath);
      streamPipeline(res, file).then(() => resolve(true)).catch(() => resolve(false));
    }).on('error', () => resolve(false));
  });
}

async function downloadAssets(parsed, assetsDir) {
  logger.step('Downloading assets...');
  let main = 0, detail = 0, sku = 0;

  // 主图 → 主图/
  const mainDir = path.join(assetsDir, '主图');
  for (let i = 0; i < parsed.mainImages.length; i++) {
    const url = parsed.mainImages[i];
    const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg';
    const dest = path.join(mainDir, `${String(i + 1).padStart(2, '0')}.${ext}`);
    const ok = await downloadFile(url, dest);
    if (ok) main++;
    else logger.warn(`  Failed: ${url.substring(0, 60)}...`);
  }
  logger.info(`  Main: ${main}/${parsed.mainImages.length}`);

  // 详情图 → 详情图/
  const detailDir = path.join(assetsDir, '详情图');
  for (let i = 0; i < parsed.detailImages.length; i++) {
    const url = parsed.detailImages[i];
    const ext = url.match(/\.(jpe?g|png|webp|gif)/i)?.[1] || 'jpg';
    const dest = path.join(detailDir, `${String(i + 1).padStart(2, '0')}.${ext}`);
    const ok = await downloadFile(url, dest);
    if (ok) detail++;
    else logger.warn(`  Failed: ${url.substring(0, 60)}...`);
  }
  logger.info(`  Detail: ${detail}/${parsed.detailImages.length}`);

  return { main, detail, sku };
}

module.exports = { downloadAssets };
