/**
 * 填写 SKU 表 —— 逐行价格+预览图，支持滚动查找全部行
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
 * 获取款式 → 图片文件名映射
 */
function getStyleImageMap(skuRows) {
  const map = {};
  for (const s of skuRows) {
    const style = s.specs[0];
    if (style && s.previewImage && !map[style]) map[style] = path.basename(s.previewImage);
  }
  return map;
}

/**
 * 主入口
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Table ===');

  await page.evaluate(() => { const t = document.querySelector('table'); if (t) t.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(500);

  const skuRows = product.skuRows;

  // ---- 打印所有 SKU 行 ----
  for (let j = 0; j < skuRows.length; j++) {
    const s = skuRows[j];
    const pv = s.previewImage || '';
    const ex = pv ? fs.existsSync(pv) : false;
    logger.info(`  SKU${j + 1}: ${s.specs.join(' / ')} | 拼${s.groupPrice} 单${s.singlePrice} 库${s.stock} | img=${path.basename(pv) || '-'} ${ex ? '✓' : '✗'}`);
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

  // ---- Step 2: 上传 SKU 预览图（逐行滚动处理） ----
  const styleMap = getStyleImageMap(skuRows);
  logger.info(`Style→image: ${JSON.stringify(styleMap)}`);

  let previewsOk = 0;
  skuIdx = 0;
  let lastStyle = '';
  const uploadedStyles = new Set();

  for (let i = 0; i < totalRows; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;
    if (skuIdx >= skuRows.length) break;

    const target = skuRows[skuIdx];
    const currentStyle = target.specs[0];
    const imgBasename = styleMap[currentStyle] || path.basename(target.previewImage || '');

    // 滚动该行到视野
    try { await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); } catch {}

    // 打印行信息
    logger.info(`  Row${skuIdx + 1}: ${currentStyle} / ${target.specs[1]} | img=${imgBasename}`);

    // 只在首次遇到该款式时上传（同款式多行共享一张图）
    if (!uploadedStyles.has(currentStyle) && imgBasename && target.previewImage) {
      const imgPath = target.previewImage;
      if (fs.existsSync(imgPath)) {
        // 在当前行找 file input
        const fileInputs = row.locator('input[type="file"]');
        const fcnt = await fileInputs.count();
        if (fcnt > 0) {
          try {
            await fileInputs.first().setInputFiles(imgPath);
            await page.waitForTimeout(300);
            previewsOk++;
            uploadedStyles.add(currentStyle);
            logger.info(`    ✓ uploaded ${imgBasename}`);

            // 截图（每3行一次）
            if (skuIdx === 0 || skuIdx === 3 || skuIdx === 6) {
              await takeScreenshot(page, `09_sku_preview_row${skuIdx + 1}`);
            }
          } catch (err) {
            logger.warn(`    ✗ upload error: ${err.message}`);
          }
        } else {
          logger.warn(`    ✗ no file input in this row`);
        }
      } else {
        logger.warn(`    ✗ image missing: ${imgPath}`);
      }
    } else if (uploadedStyles.has(currentStyle)) {
      logger.info(`    (shared with earlier rows of "${currentStyle}")`);
      previewsOk++; // 计入（共享图）
    }

    lastStyle = currentStyle;
    skuIdx++;
  }

  await takeScreenshot(page, '09_sku_table_done');

  // ---- 校验 ----
  const fi = await inspectSkuTable(page);
  const fully = fi.filter(r => r.values.length >= 2 && r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' && r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入').length;

  // 各组图片上传汇总
  const mixRows = skuRows.reduce((a, s, i) => { if ((s.previewImage || '').includes('mix')) a.push(i + 1); return a; }, []);
  const redRows = skuRows.reduce((a, s, i) => { if ((s.previewImage || '').includes('red')) a.push(i + 1); return a; }, []);
  const blueRows = skuRows.reduce((a, s, i) => { if ((s.previewImage || '').includes('blue')) a.push(i + 1); return a; }, []);

  logger.info(`SKU: ${fully}/${fi.length} price-filled | ${previewsOk} previews`);
  logger.info(`  mix.png rows: ${mixRows.join(',')}`);
  logger.info(`  red.png rows: ${redRows.join(',')}`);
  logger.info(`  blue.png rows: ${blueRows.join(',')}`);

  if (fully < fi.length) {
    logger.warn(`${fi.length - fully} rows empty — JS fallback`);
    await jsFallback(page, skuRows);
    const fi2 = await inspectSkuTable(page);
    const ff2 = fi2.filter(r => r.values.length >= 2 && r.values[0] && r.values[0] !== '' && r.values[0] !== '0').length;
    logger.info(`After fallback: ${ff2}/${fi2.length}`);
  }
}

module.exports = { fillSkuTable, inspectSkuTable };
