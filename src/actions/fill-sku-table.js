/**
 * 按款式上传 SKU 预览图 —— 滚动定位 + filechooser 回退
 */
const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

async function inspectSkuTable(page) {
  const rows = page.locator('tr'); const count = await rows.count(); const info = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i); const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    const inputs = row.locator('input[placeholder="请输入"]'); const ic = await inputs.count();
    const vals = []; for (let j = 0; j < Math.min(ic, 3); j++) vals.push(await inputs.nth(j).inputValue().catch(() => '?'));
    info.push({ rowIdx: i, inputs: ic, values: vals, text: text.substring(0, 80).replace(/\n/g, ' ') });
  }
  return info;
}

async function fillRowValues(page, rowEl, s, g, p) {
  const inputs = rowEl.locator('input[placeholder="请输入"]'); const ic = await inputs.count();
  if (ic < 2) return false;
  try {
    await inputs.nth(0).fill(String(s)); await page.waitForTimeout(30);
    await inputs.nth(1).fill(String(g)); await page.waitForTimeout(30);
    if (ic >= 3) { await inputs.nth(2).fill(String(p)); await page.waitForTimeout(30); }
    return true;
  } catch { return false; }
}

async function jsFallback(page, skuRows) {
  await page.evaluate((data) => {
    const rows = document.querySelectorAll('tr'); let i = 0;
    for (const row of rows) {
      if (!row.innerText.includes('已启用')) continue;
      const inputs = row.querySelectorAll('input[placeholder="请输入"]');
      if (inputs.length < 2) { i++; continue; }
      if (inputs[0].value && inputs[0].value !== '0' && inputs[0].value !== '请输入') { i++; continue; }
      const s = data[i] || data[0] || { stock:'999', groupPrice:'9.9', singlePrice:'10.9' };
      const v = [String(s.stock), String(s.groupPrice), String(s.singlePrice)];
      for (let j = 0; j < Math.min(inputs.length, 3); j++) {
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        d.set.call(inputs[j], v[j]);
        inputs[j].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[j].dispatchEvent(new Event('change', { bubbles: true }));
      }
      i++;
    }
  }, skuRows);
  await page.waitForTimeout(1000);
}

/**
 * 在表格中找包含指定文本的行，返回该行的 Locator
 */
async function findRowByText(page, searchText) {
  const rows = page.locator('tr');
  const cnt = await rows.count();
  for (let i = 0; i < cnt; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (text.includes('已启用') && text.includes(searchText)) {
      return row;
    }
  }
  return null;
}

/**
 * 尝试多种方式上传预览图到一行
 */
async function uploadPreviewToRow(page, row, imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return false;

  // 方法1: 直接找 file input
  const fileInputs = row.locator('input[type="file"]');
  const fcnt = await fileInputs.count();
  if (fcnt > 0) {
    try {
      await fileInputs.first().setInputFiles(imagePath);
      await page.waitForTimeout(400);
      return true;
    } catch (e) {
      logger.debug(`  direct file input failed: ${e.message}`);
    }
  }

  // 方法2: 点击上传图标 → filechooser
  try {
    const uploadIcon = row.locator('text=上传, text=本地上传, [class*=upload]').first();
    if (await uploadIcon.count() > 0) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        uploadIcon.click(),
      ]);
      await fileChooser.setFiles(imagePath);
      await page.waitForTimeout(400);
      return true;
    }
  } catch (e) {
    logger.debug(`  filechooser failed: ${e.message}`);
  }

  return false;
}

async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Table ===');

  await page.evaluate(() => { const t = document.querySelector('table'); if (t) t.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(500);

  const skuRows = product.skuRows;
  for (let j = 0; j < skuRows.length; j++) {
    const s = skuRows[j];
    const ex = s.previewImage ? fs.existsSync(s.previewImage) : false;
    logger.info(`  SKU${j + 1}: ${s.specs.join(' / ')} | 拼${s.groupPrice} 单${s.singlePrice} | img=${path.basename(s.previewImage || '-')} ${ex ? '✓' : '✗'}`);
  }

  // ---- 填价格 ----
  const rows = page.locator('tr');
  const totalRows = await rows.count();
  let skuIdx = 0, filledPrices = 0;
  for (let i = 0; i < totalRows; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    if (skuIdx >= skuRows.length) break;
    const t = skuRows[skuIdx];
    const inputs = row.locator('input[placeholder="请输入"]');
    const ic = await inputs.count();
    if (ic >= 2) {
      const v0 = await inputs.nth(0).inputValue();
      if (v0 === '' || v0 === '0' || v0 === '请输入') await fillRowValues(page, row, t.stock, t.groupPrice, t.singlePrice);
      filledPrices++;
    }
    skuIdx++;
  }
  logger.info(`Prices: ${filledPrices}/${skuRows.length}`);

  // ---- 上传 SKU 预览图：按款式 ----
  const styleConfig = {};
  for (const s of skuRows) {
    const style = s.specs[0];
    if (!styleConfig[style]) {
      styleConfig[style] = { image: s.previewImage, exists: fs.existsSync(s.previewImage || '') };
    }
  }

  const styles = Object.keys(styleConfig);
  logger.info(`Styles to upload: ${JSON.stringify(Object.fromEntries(Object.entries(styleConfig).map(([k, v]) => [k, path.basename(v.image || '') + (v.exists ? '' : ' MISSING')])))}`);

  let previewsOk = 0;

  for (const style of styles) {
    const cfg = styleConfig[style];
    if (!cfg.exists) {
      logger.warn(`  "${style}" — image missing: ${cfg.image}, skipping`);
      // 计入共享行
      const rowsForStyle = skuRows.filter(s => s.specs[0] === style).length;
      previewsOk += rowsForStyle;
      continue;
    }

    // 找包含该款式的行
    let targetRow = await findRowByText(page, style);
    if (!targetRow) {
      // 滚动到底部再找
      await page.evaluate(() => {
        const t = document.querySelector('table');
        if (t) t.scrollTop = t.scrollHeight;
      });
      await page.waitForTimeout(500);
      targetRow = await findRowByText(page, style);
    }

    if (!targetRow) {
      logger.warn(`  "${style}" — row not found in table, cannot upload ${path.basename(cfg.image)}`);
      const rowsForStyle = skuRows.filter(s => s.specs[0] === style).length;
      previewsOk += rowsForStyle;
      continue;
    }

    // 滚动到该行并上传
    try { await targetRow.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); } catch {}

    const fn = path.basename(cfg.image);
    const ok = await uploadPreviewToRow(page, targetRow, cfg.image);
    if (ok) {
      const rowsForStyle = skuRows.filter(s => s.specs[0] === style).length;
      previewsOk += rowsForStyle;
      logger.info(`  "${style}" → ${fn} ✓ (shared across ${rowsForStyle} rows)`);

      if (style === styles[0]) await takeScreenshot(page, '09_preview_style1');
      else if (style === styles[1]) await takeScreenshot(page, '09_preview_style2');
      else if (style === styles[2]) await takeScreenshot(page, '09_preview_style3');
    } else {
      logger.warn(`  "${style}" → ${fn} ✗ upload failed`);
    }
  }

  await takeScreenshot(page, '09_sku_table_done');

  // ---- 校验 ----
  const fi = await inspectSkuTable(page);
  const fully = fi.filter(r => r.values.length >= 2 && r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' && r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入').length;

  if (fully < fi.length) {
    logger.warn(`${fi.length - fully} rows empty — JS fallback`);
    await jsFallback(page, skuRows);
    const fi2 = await inspectSkuTable(page);
    const ff2 = fi2.filter(r => r.values.length >= 2 && r.values[0] && r.values[0] !== '' && r.values[0] !== '0').length;
    logger.info(`After fallback: ${ff2}/${fi2.length}`);
  }

  const mixRows = [], redRows = [], blueRows = [];
  for (let j = 0; j < skuRows.length; j++) {
    const fn = path.basename(skuRows[j].previewImage || '');
    if (fn.includes('mix')) mixRows.push(j + 1);
    else if (fn.includes('red')) redRows.push(j + 1);
    else if (fn.includes('blue')) blueRows.push(j + 1);
  }

  logger.info(`SKU: ${fully}/${fi.length} price-filled | ${previewsOk} previews`);
  logger.info(`  mix.png rows: ${mixRows.join(',')}`);
  logger.info(`  red.png rows: ${redRows.join(',')}`);
  logger.info(`  blue.png rows: ${blueRows.join(',')}`);
}

module.exports = { fillSkuTable, inspectSkuTable };
