/**
 * 填写 SKU 价格表 —— 严格按 Excel sku 行序 + 智能预览图上传
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 统计页面 SKU 行
 */
async function inspectSkuTable(page) {
  const rows = page.locator('tr');
  const count = await rows.count();
  const info = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    const inputs = row.locator('input[placeholder="请输入"]');
    const ic = await inputs.count();
    const vals = [];
    for (let j = 0; j < Math.min(ic, 3); j++) vals.push(await inputs.nth(j).inputValue().catch(() => '?'));
    const fileInputs = row.locator('input[type="file"]');
    info.push({ rowIdx: i, inputs: ic, values: vals, hasFileInput: (await fileInputs.count()) > 0, text: text.substring(0, 80).replace(/\n/g, ' ') });
  }
  return info;
}

/**
 * 给一个 Locator 设值（库存+价格）
 */
async function fillRowValues(page, rowEl, stock, gp, sp) {
  const inputs = rowEl.locator('input[placeholder="请输入"]');
  const ic = await inputs.count();
  if (ic < 2) return false;
  try {
    await inputs.nth(0).fill(String(stock)); await page.waitForTimeout(50);
    await inputs.nth(1).fill(String(gp)); await page.waitForTimeout(50);
    if (ic >= 3) { await inputs.nth(2).fill(String(sp)); await page.waitForTimeout(50); }
    return true;
  } catch { return false; }
}

/**
 * 上传单张预览图
 */
async function uploadOnePreview(page, fileEl, imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return { ok: false, reason: 'file missing' };
  try {
    await fileEl.setInputFiles(imagePath);
    await page.waitForTimeout(300);
    return { ok: true, reason: '' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * JS fallback
 */
async function jsFallback(page, skuRows) {
  await page.evaluate((data) => {
    const rows = document.querySelectorAll('tr'); let skuIdx = 0;
    for (const row of rows) {
      if (!row.innerText.includes('已启用')) continue;
      const inputs = row.querySelectorAll('input[placeholder="请输入"]');
      if (inputs.length < 2) { skuIdx++; continue; }
      if (inputs[0].value && inputs[0].value !== '0' && inputs[0].value !== '请输入') { skuIdx++; continue; }
      const s = data[skuIdx] || data[0] || { stock:'999', groupPrice:'9.9', singlePrice:'10.9' };
      const v = [String(s.stock), String(s.groupPrice), String(s.singlePrice)];
      for (let j = 0; j < Math.min(inputs.length, 3); j++) {
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(inputs[j], v[j]);
        inputs[j].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[j].dispatchEvent(new Event('change', { bubbles: true }));
      }
      skuIdx++;
    }
  }, skuRows);
  await page.waitForTimeout(1000);
}

/**
 * 提取款式→图片映射
 */
function getStyleImageMap(skuRows) {
  const map = {};
  for (const s of skuRows) {
    const style = s.specs[0]; // 第一个规格是"款式"
    if (style && s.previewImage && !map[style]) {
      map[style] = s.previewImage;
    }
  }
  return map;
}

/**
 * 主入口
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Table ===');

  await page.evaluate(() => { const t = document.querySelector('table'); if (t) t.scrollIntoView({ block: 'center' }); });
  await page.waitForTimeout(500);

  const info = await inspectSkuTable(page);
  logger.info(`Page: ${info.length} SKU rows`);
  const skuRows = product.skuRows;
  logger.info(`Excel: ${skuRows.length} SKU rows`);

  // ---- 打印每个 SKU 详情 ----
  for (let j = 0; j < skuRows.length; j++) {
    const s = skuRows[j];
    const pvPath = s.previewImage || '';
    const exists = pvPath ? fs.existsSync(pvPath) : false;
    const size = exists ? (fs.statSync(pvPath).size / 1024).toFixed(1) + 'KB' : 'N/A';
    logger.info(`  SKU${j + 1}: ${s.specs.join(' / ')} | 拼${s.groupPrice} 单${s.singlePrice} 库${s.stock} | img=${path.basename(pvPath) || '(none)'} ${exists ? '✓ ' + size : '✗ MISSING'}`);
  }

  // ---- 填价格 ----
  const rows = page.locator('tr');
  const totalRows = await rows.count();
  let filled = 0, skuIdx = 0;

  for (let i = 0; i < totalRows; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    if (skuIdx >= skuRows.length) break;
    const target = skuRows[skuIdx];
    const inputs = row.locator('input[placeholder="请输入"]');
    const ic = await inputs.count();
    if (ic >= 2) {
      const v0 = await inputs.nth(0).inputValue();
      if (v0 === '' || v0 === '0' || v0 === '请输入') {
        await fillRowValues(page, row, target.stock, target.groupPrice, target.singlePrice);
      }
      filled++;
    }
    skuIdx++;
  }
  logger.info(`Prices: ${filled}/${skuRows.length} rows`);

  // ---- 上传 SKU 预览图 ----
  // 检测：每行都有 file input 还是只有款式行有
  const rowsWithFile = info.filter(r => r.hasFileInput).length;
  logger.info(`Rows with file input: ${rowsWithFile} / ${info.length}`);

  let previewsOk = 0;

  if (rowsWithFile <= 6 && rowsWithFile >= 2) {
    // === 按款式上传（3个款式，每款多行共享一张图）===
    logger.info('Detected per-style preview mode');
    const styleMap = getStyleImageMap(skuRows);
    logger.info(`Style→image map: ${JSON.stringify(styleMap)}`);

    // 找到所有 file input（它们集中在有款式名的行）
    const allFileInputs = page.locator('input[type="file"]');
    const totalFileInputs = await allFileInputs.count();
    logger.info(`Total file inputs on page: ${totalFileInputs}`);

    // 跳过主图/视频的 file input（前面5-6个是主图/视频/详情/素材）
    const skipFirst = 5; // 轮播图 + 视频 + 讲解 + 商详 + 素材

    const styles = Object.keys(styleMap);
    for (let s = 0; s < styles.length; s++) {
      const style = styles[s];
      const imgFile = styleMap[style];
      const imgPath = path.join(config.paths.assets, product.productId, path.basename(imgFile));
      const exists = fs.existsSync(imgPath);

      logger.info(`  Style "${style}" → ${path.basename(imgFile)} | ${exists ? '✓' : '✗ MISSING'}`);

      if (exists && skipFirst + s < totalFileInputs) {
        const fileEl = allFileInputs.nth(skipFirst + s);
        const result = await uploadOnePreview(page, fileEl, imgPath);
        if (result.ok) { previewsOk++; logger.info(`    Uploaded ✓`); }
        else logger.warn(`    Failed: ${result.reason}`);
      }
    }
  } else {
    // === 按 SKU 行上传（每行都有 file input）===
    logger.info('Detected per-row preview mode');
    skuIdx = 0;
    for (let i = 0; i < totalRows; i++) {
      const row = rows.nth(i);
      const text = await row.innerText();
      if (!text.includes('已启用')) continue;
      if (skuIdx >= skuRows.length) break;

      const target = skuRows[skuIdx];
      if (target.previewImage && fs.existsSync(target.previewImage)) {
        const fileInputs = row.locator('input[type="file"]');
        const fcnt = await fileInputs.count();
        if (fcnt > 0) {
          const result = await uploadOnePreview(page, fileInputs.first(), target.previewImage);
          if (result.ok) previewsOk++;
        }
      }
      skuIdx++;
    }
  }

  await takeScreenshot(page, '09_sku_table_filled');

  // ---- 校验 ----
  const fi = await inspectSkuTable(page);
  const fullyFilled = fi.filter(r =>
    r.values.length >= 2 && r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
    r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入'
  ).length;

  logger.info(`SKU: ${fullyFilled}/${fi.length} price-filled | ${previewsOk} previews uploaded`);

  if (fullyFilled < fi.length) {
    logger.warn(`${fi.length - fullyFilled} rows empty — JS fallback...`);
    await jsFallback(page, skuRows);
    const fi2 = await inspectSkuTable(page);
    const ff2 = fi2.filter(r => r.values.length >= 2 && r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入').length;
    logger.info(`After fallback: ${ff2}/${fi2.length}`);
  }
}

module.exports = { fillSkuTable, inspectSkuTable };
