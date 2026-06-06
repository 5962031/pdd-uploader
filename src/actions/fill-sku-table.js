/**
 * 填写 SKU 表 —— 9行逐行上传预览图
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
 * 在当前行上传预览图（含旧图清除回退）
 */
async function uploadToRow(page, rowEl, imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return false;

  // 方法1: 直接 file input
  const fileInputs = rowEl.locator('input[type="file"]');
  const fcnt = await fileInputs.count();
  if (fcnt > 0) {
    try {
      await fileInputs.first().setInputFiles(imagePath);
      await page.waitForTimeout(300);
      return true;
    } catch (e) { logger.debug(`  direct file input failed: ${e.message}`); }
  }

  // 方法2: 点击上传图标 → filechooser
  try {
    // 点击行内的上传区域
    const uploadArea = rowEl.locator('text=上传, text=本地上传').first();
    if (await uploadArea.count() > 0) {
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 3000 }),
        uploadArea.click(),
      ]);
      await fc.setFiles(imagePath);
      await page.waitForTimeout(300);
      return true;
    }
  } catch (e) { logger.debug(`  filechooser failed: ${e.message}`); }

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
  let skuIdx = 0, filledPrices = 0;
  // 不缓存行数（虚拟滚动）
  for (let pass = 0; pass < 5 && skuIdx < skuRows.length; pass++) {
    const curTotal = await rows.count();
    for (let i = 0; i < curTotal && skuIdx < skuRows.length; i++) {
      const row = rows.nth(i);
      const text = await row.innerText();
      if (!text.includes('已启用')) continue;
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
    if (skuIdx < skuRows.length) {
      await page.evaluate(() => { const t = document.querySelector('table'); if (t) t.scrollTop = t.scrollHeight; });
      await page.waitForTimeout(800);
    }
  }
  logger.info(`Prices: ${filledPrices}/${skuRows.length}`);

  // ---- 逐行上传 SKU 预览图（9行全部，含蓝色） ----
  let previewsOk = 0;
  skuIdx = 0;

  // 不缓存 totalRows —— 每次循环重新计算（虚拟滚动表格会动态加载行）
  for (let pass = 0; pass < 5 && skuIdx < skuRows.length; pass++) {
    const curTotal = await rows.count();
    let progressed = false;

    for (let i = 0; i < curTotal && skuIdx < skuRows.length; i++) {
      const row = rows.nth(i);
      const text = await row.innerText();
      if (!text.includes('已启用')) continue;

      // 跳过已经处理过的行
      if (skuIdx >= skuRows.length) break;

      const target = skuRows[skuIdx];
      const fn = path.basename(target.previewImage || '');
      const cap = target.specs[1];
      const style = target.specs[0];

      // 强制滚动到当前行
      try { await row.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); } catch {}

      logger.info(`  Row${skuIdx + 1}: ${style} / ${cap} | img=${fn}`);

      if (target.previewImage && fs.existsSync(target.previewImage)) {
        const ok = await uploadToRow(page, row, target.previewImage);
        if (ok) {
          previewsOk++; progressed = true;
          logger.info(`    → ${fn} uploaded ✓`);
        } else {
          // filechooser 回退
          logger.warn(`    direct upload failed, trying filechooser...`);
          try {
            const uploadTrigger = row.locator('text=上传, text=本地上传').first();
            if (await uploadTrigger.count() > 0) {
              const [fc] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }),
                uploadTrigger.click(),
              ]);
              await fc.setFiles(target.previewImage);
              await page.waitForTimeout(400);
              previewsOk++; progressed = true;
              logger.info(`    → ${fn} uploaded via filechooser ✓`);
            } else {
              const html = await row.innerHTML();
              logger.warn(`    ✗ no upload trigger. Row HTML (first 300): ${html.substring(0, 300)}`);
              await takeScreenshot(page, `09_fail_row${skuIdx + 1}`);
            }
          } catch (e2) {
            logger.warn(`    ✗ filechooser also failed: ${e2.message}`);
            await takeScreenshot(page, `09_fail_row${skuIdx + 1}`);
          }
        }
      } else {
        logger.warn(`    ✗ image missing: ${target.previewImage || '(none)'}`);
      }

      skuIdx++;

      if (skuIdx === 3 || skuIdx === 6 || skuIdx === 9) {
        await takeScreenshot(page, `09_sku_preview_row${skuIdx}`);
      }
    }

    // 如果还有剩余行没处理，滚动表格到底部并重新计数
    if (skuIdx < skuRows.length) {
      logger.info(`  Still ${skuRows.length - skuIdx} rows remaining, scrolling table to bottom...`);
      await page.evaluate(() => {
        const t = document.querySelector('table');
        if (t) { t.scrollTop = t.scrollHeight; }
      });
      await page.waitForTimeout(1000);
    }

    if (!progressed) break; // 卡住了，退出
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

  logger.info(`SKU: ${fully}/${fi.length} price-filled | previews: ${previewsOk}/${skuRows.length}`);
  logger.info(`  mix.png rows: ${mixRows.join(',')}`);
  logger.info(`  red.png rows: ${redRows.join(',')}`);
  logger.info(`  blue.png rows: ${blueRows.join(',')}`);
}

module.exports = { fillSkuTable, inspectSkuTable };
