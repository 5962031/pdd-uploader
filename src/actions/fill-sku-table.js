/**
 * 填写 SKU 价格表 —— 按 Excel sku 工作表逐行填充（含预览图）
 */
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

    info.push({ rowIdx: i, inputs: ic, values: vals, text: text.substring(0, 80).replace(/\n/g, ' ') });
  }

  return info;
}

/**
 * 填一个 SKU 行的库存+价格
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
 * 上传单个 SKU 行的预览图
 */
async function uploadSkuPreview(page, rowEl, imagePath) {
  if (!imagePath) return; // 没有图片，跳过

  const fs = require('fs');
  if (!fs.existsSync(imagePath)) {
    logger.warn(`  Preview image not found: ${imagePath}`);
    return;
  }

  try {
    // 找到这一行的 file input
    const fileInputs = rowEl.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      await fileInputs.first().setInputFiles(imagePath);
    }
  } catch (err) {
    logger.warn(`  Preview upload error: ${err.message}`);
  }
}

/**
 * JS fallback：直接 DOM 设值
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
 * 主入口 —— 按 Excel sku 表逐行填充
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Table ===');

  // 滚动到表格
  await page.evaluate(() => {
    const table = document.querySelector('table');
    if (table) table.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  // 检查页面状态
  let info = await inspectSkuTable(page);
  logger.info(`Page has ${info.length} enabled SKU rows`);

  const skuRows = product.skuRows;
  logger.info(`Excel has ${skuRows.length} SKU rows`);

  if (info.length === 0) {
    throw new Error('SKU table has no enabled rows');
  }
  if (skuRows.length === 0) {
    throw new Error('Excel sku sheet is empty');
  }

  // 打印每行信息供调试
  info.slice(0, 5).forEach(r => {
    logger.debug(`  Row ${r.rowIdx + 1}: ${r.inputs} inputs, vals=[${r.values.join(',')}]`);
  });
  if (info.length > 5) logger.debug(`  ... and ${info.length - 5} more rows`);

  // ============================================================
  // 按行序逐个填写（页面行顺序 = Excel sku 表顺序）
  // ============================================================
  const rows = page.locator('tr');
  const totalRows = await rows.count();

  let filled = 0;
  let previewsUploaded = 0;
  let skuIdx = 0;

  for (let i = 0; i < totalRows; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    if (skuIdx >= skuRows.length) break;

    const target = skuRows[skuIdx];

    // 检查是否已填
    const inputs = row.locator('input[placeholder="请输入"]');
    const ic = await inputs.count();
    if (ic < 2) { skuIdx++; continue; }

    const v0 = await inputs.nth(0).inputValue();
    if (v0 !== '' && v0 !== '0' && v0 !== '请输入') {
      skuIdx++;
      continue; // 可能已填
    }

    // 填写库存+价格
    const ok = await fillRowValues(page, row, target.stock, target.groupPrice, target.singlePrice);
    if (ok) filled++;

    // 上传预览图
    if (target.previewImage) {
      await uploadSkuPreview(page, row, target.previewImage);
      previewsUploaded++;
    }

    skuIdx++;
  }

  await takeScreenshot(page, '09_sku_table_filled');

  // ---- 校验 ----
  info = await inspectSkuTable(page);

  const fullyFilled = info.filter(r =>
    r.values.length >= 2 &&
    r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
    r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入'
  ).length;

  logger.info(`SKU: ${fullyFilled}/${info.length} filled, ${previewsUploaded} previews uploaded`);

  if (fullyFilled < info.length) {
    logger.warn(`${info.length - fullyFilled} rows still empty — running JS fallback...`);
    await jsFallback(page, skuRows);
    info = await inspectSkuTable(page);
    const final = info.filter(r =>
      r.values.length >= 2 &&
      r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
      r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入'
    ).length;
    logger.info(`After fallback: ${final}/${info.length} filled`);
  }
}

module.exports = { fillSkuTable, inspectSkuTable };
