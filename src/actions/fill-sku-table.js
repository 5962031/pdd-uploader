/**
 * 填写 SKU 价格表 —— 按 Excel sku 工作表逐行填充（含预览图）
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 统计页面 SKU 行状态
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
    for (let j = 0; j < Math.min(ic, 3); j++) {
      vals.push(await inputs.nth(j).inputValue().catch(() => '?'));
    }
    // 检查是否有 file input（预览图）
    const fileInputs = row.locator('input[type="file"]');
    const hasFileInput = (await fileInputs.count()) > 0;

    info.push({
      rowIdx: i,
      inputs: ic,
      values: vals,
      hasFileInput,
      text: text.substring(0, 80).replace(/\n/g, ' '),
    });
  }

  return info;
}

/**
 * 填写一个 SKU 行的库存+价格
 */
async function fillRowValues(page, rowEl, stock, groupPrice, singlePrice) {
  const inputs = rowEl.locator('input[placeholder="请输入"]');
  const ic = await inputs.count();
  if (ic < 2) return false;

  try {
    await inputs.nth(0).fill(String(stock));
    await page.waitForTimeout(50);
    await inputs.nth(1).fill(String(groupPrice));
    await page.waitForTimeout(50);
    if (ic >= 3) {
      await inputs.nth(2).fill(String(singlePrice));
      await page.waitForTimeout(50);
    }
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 上传当前 SKU 行的预览图
 * @param {import('playwright').Page} page
 * @param {import('playwright').Locator} rowEl - 当前行的 locator
 * @param {string} imagePath - 绝对路径
 */
async function uploadSkuPreview(page, rowEl, imagePath) {
  if (!imagePath) return { ok: false, reason: 'no path in Excel' };
  if (!fs.existsSync(imagePath)) return { ok: false, reason: `file not found: ${imagePath}` };

  try {
    // 在当前行中找到 file input（预览图上传控件，不是主图上传区）
    const fileInputs = rowEl.locator('input[type="file"]');
    const cnt = await fileInputs.count();
    if (cnt === 0) return { ok: false, reason: 'no file input in this row' };

    await fileInputs.first().setInputFiles(imagePath);
    await page.waitForTimeout(200);
    return { ok: true, reason: '' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * JS fallback 填库存+价格
 */
async function jsFallback(page, skuRows) {
  await page.evaluate((data) => {
    const rows = document.querySelectorAll('tr');
    let skuIdx = 0;
    for (const row of rows) {
      if (!row.innerText.includes('已启用')) continue;
      const inputs = row.querySelectorAll('input[placeholder="请输入"]');
      if (inputs.length < 2) { skuIdx++; continue; }
      if (inputs[0].value && inputs[0].value !== '0' && inputs[0].value !== '请输入') { skuIdx++; continue; }

      const s = data[skuIdx] || data[0] || { stock: '999', groupPrice: '9.9', singlePrice: '10.9' };
      const vals = [String(s.stock), String(s.groupPrice), String(s.singlePrice)];
      for (let j = 0; j < Math.min(inputs.length, 3); j++) {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc.set.call(inputs[j], vals[j]);
        inputs[j].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[j].dispatchEvent(new Event('change', { bubbles: true }));
      }
      skuIdx++;
    }
  }, skuRows);
  await page.waitForTimeout(1000);
}

/**
 * 解析预览图绝对路径
 */
function resolvePreviewPath(productId, previewFile) {
  if (!previewFile || String(previewFile).trim() === '') return '';
  const assetDir = path.join(config.paths.assets, productId);
  const full = path.join(assetDir, path.basename(String(previewFile)));
  return full;
}

/**
 * 主入口
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Table ===');

  // 滚动到表格
  await page.evaluate(() => {
    const table = document.querySelector('table');
    if (table) table.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  const info = await inspectSkuTable(page);
  logger.info(`Page: ${info.length} enabled SKU rows`);

  const skuRows = product.skuRows;
  logger.info(`Excel: ${skuRows.length} SKU rows`);

  if (info.length === 0) throw new Error('SKU table empty');
  if (skuRows.length === 0) throw new Error('Excel sku sheet empty');

  // 打印每行详情
  skuRows.forEach((s, i) => {
    const resolved = resolvePreviewPath(product.productId, s.previewImage);
    const exists = fs.existsSync(resolved);
    logger.info(`  SKU${i + 1}: ${s.specs.join(' / ')} | 拼${s.groupPrice} 单${s.singlePrice} 库存${s.stock} | 预览图: ${s.previewImage || '(none)'} → ${exists ? '✓' : '✗ file not found'}`);
  });

  const rows = page.locator('tr');
  const totalRows = await rows.count();

  let filled = 0;
  let previewsOk = 0;
  let previewsSkipped = 0;
  let skuIdx = 0;

  for (let i = 0; i < totalRows; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    if (skuIdx >= skuRows.length) break;

    const target = skuRows[skuIdx];

    // 填库存+价格
    const inputs = row.locator('input[placeholder="请输入"]');
    const ic = await inputs.count();
    if (ic >= 2) {
      const v0 = await inputs.nth(0).inputValue();
      if (v0 === '' || v0 === '0' || v0 === '请输入') {
        const ok = await fillRowValues(page, row, target.stock, target.groupPrice, target.singlePrice);
        if (ok) filled++;
      } else {
        filled++; // 已填
      }
    }

    // 上传预览图
    const resolvedPath = resolvePreviewPath(product.productId, target.previewImage);
    if (resolvedPath && fs.existsSync(resolvedPath)) {
      const result = await uploadSkuPreview(page, row, resolvedPath);
      if (result.ok) {
        previewsOk++;
        logger.debug(`  SKU${skuIdx + 1} preview ✓`);
      } else {
        previewsSkipped++;
        logger.debug(`  SKU${skuIdx + 1} preview ✗: ${result.reason}`);
      }
    } else if (target.previewImage) {
      previewsSkipped++;
      logger.debug(`  SKU${skuIdx + 1} preview ✗: file not found — ${resolvedPath}`);
    }

    skuIdx++;
  }

  await takeScreenshot(page, '09_sku_table_filled');

  // ---- 校验 ----
  const finalInfo = await inspectSkuTable(page);
  const fullyFilled = finalInfo.filter(r =>
    r.values.length >= 2 &&
    r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
    r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入'
  ).length;

  logger.info(`SKU: ${fullyFilled}/${finalInfo.length} price-filled, ${previewsOk} previews uploaded, ${previewsSkipped} skipped`);

  if (fullyFilled < finalInfo.length) {
    logger.warn(`${finalInfo.length - fullyFilled} rows still empty — JS fallback...`);
    await jsFallback(page, skuRows);
    const info2 = await inspectSkuTable(page);
    const final = info2.filter(r =>
      r.values.length >= 2 &&
      r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
      r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入'
    ).length;
    logger.info(`After fallback: ${final}/${info2.length}`);
  }
}

module.exports = { fillSkuTable, inspectSkuTable, resolvePreviewPath };
