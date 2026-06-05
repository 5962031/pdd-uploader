/**
 * 填写 SKU 表 —— 逐行价格+预览图，确保全部9行处理
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

async function fillRowValues(page, rowEl, stock, gp, sp) {
  const inputs = rowEl.locator('input[placeholder="请输入"]'); const ic = await inputs.count();
  if (ic < 2) return false;
  try {
    await inputs.nth(0).fill(String(stock)); await page.waitForTimeout(40);
    await inputs.nth(1).fill(String(gp)); await page.waitForTimeout(40);
    if (ic >= 3) { await inputs.nth(2).fill(String(sp)); await page.waitForTimeout(40); }
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
      const s = data[i] || data[0] || { stock: '999', groupPrice: '9.9', singlePrice: '10.9' };
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
 * 上传一张预览图到当前行的 file input
 */
async function uploadToRow(page, rowEl, imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return false;
  try {
    const fileInputs = rowEl.locator('input[type="file"]');
    const cnt = await fileInputs.count();
    if (cnt === 0) return false;
    await fileInputs.first().setInputFiles(imagePath);
    await page.waitForTimeout(300);
    return true;
  } catch { return false; }
}

/**
 * 主入口
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Table ===');

  await page.evaluate(() => { const t = document.querySelector('table'); if (t) t.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(500);

  const skuRows = product.skuRows;

  // 打印所有行
  for (let j = 0; j < skuRows.length; j++) {
    const s = skuRows[j];
    const ex = s.previewImage ? fs.existsSync(s.previewImage) : false;
    logger.info(`  SKU${j + 1}: ${s.specs.join(' / ')} | 拼${s.groupPrice} 单${s.singlePrice} | img=${path.basename(s.previewImage || '-')} ${ex ? '✓' : '✗'}`);
  }

  // ---- Step 1: 填价格 ----
  const rows = page.locator('tr');
  const totalRows = await rows.count();
  let skuIdx = 0, filledPrices = 0;

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
      filledPrices++;
    }
    skuIdx++;
  }
  logger.info(`Prices: ${filledPrices}/${skuRows.length}`);

  // ---- Step 2: 上传 SKU 预览图 ----
  // 找出每个款式首次出现的行号
  const styleFirstRow = {};
  const styleImage = {};
  for (let j = 0; j < skuRows.length; j++) {
    const style = skuRows[j].specs[0];
    if (!styleFirstRow[style]) {
      styleFirstRow[style] = j + 1; // 1-based
      styleImage[style] = skuRows[j].previewImage;
    }
  }
  logger.info(`Style first rows: ${JSON.stringify(styleFirstRow)}`);
  logger.info(`Style images: ${JSON.stringify(Object.fromEntries(Object.entries(styleImage).map(([k, v]) => [k, path.basename(v || '')])))}`);

  let previewsOk = 0;
  skuIdx = 0;
  const stylesDone = new Set();

  for (let i = 0; i < totalRows; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    if (skuIdx >= skuRows.length) break;

    const target = skuRows[skuIdx];
    const style = target.specs[0];
    const cap = target.specs[1];
    const imgFile = target.previewImage;

    // 滚动到当前行
    try { await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); } catch {}

    // 该款式首次出现 → 上传
    if (!stylesDone.has(style) && imgFile && fs.existsSync(imgFile)) {
      const fn = path.basename(imgFile);
      const ok = await uploadToRow(page, row, imgFile);
      if (ok) {
        stylesDone.add(style);
        previewsOk++;
        logger.info(`  Row${skuIdx + 1}: "${style}" / "${cap}" → uploaded ${fn} ✓`);
      } else {
        logger.warn(`  Row${skuIdx + 1}: "${style}" / "${cap}" → upload FAILED for ${fn}`);
      }
    } else if (stylesDone.has(style)) {
      previewsOk++;
      logger.info(`  Row${skuIdx + 1}: "${style}" / "${cap}" → img shared`);
    } else if (!imgFile) {
      logger.info(`  Row${skuIdx + 1}: "${style}" / "${cap}" → no preview in Excel`);
    } else {
      logger.warn(`  Row${skuIdx + 1}: "${style}" / "${cap}" → img missing: ${imgFile || '(none)'}`);
    }

    skuIdx++;

    // 每3行截图
    if (skuIdx === 3 || skuIdx === 6 || skuIdx === 9) {
      await takeScreenshot(page, `09_sku_preview_row${skuIdx}`);
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

  // 汇总
  const mixRows = []; const redRows = []; const blueRows = [];
  for (let j = 0; j < skuRows.length; j++) {
    const fn = path.basename(skuRows[j].previewImage || '');
    if (fn.includes('mix')) mixRows.push(j + 1);
    else if (fn.includes('red')) redRows.push(j + 1);
    else if (fn.includes('blue')) blueRows.push(j + 1);
  }

  logger.info(`SKU: ${fully}/${fi.length} price-filled | ${previewsOk} previews uploaded`);
  logger.info(`  mix.png rows: ${mixRows.join(',')}`);
  logger.info(`  red.png rows: ${redRows.join(',')}`);
  logger.info(`  blue.png rows: ${blueRows.join(',')}`);
  logger.info(`  Styles uploaded: ${[...stylesDone].join(', ')}`);
}

module.exports = { fillSkuTable, inspectSkuTable };
