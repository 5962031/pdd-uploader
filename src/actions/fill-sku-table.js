/**
 * 填写 SKU 价格表 —— 按行序填充 + 批量模式兜底
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

    info.push({
      row: i + 1,
      inputs: ic,
      values: vals,
      text: text.substring(0, 80).replace(/\n/g, ' '),
    });
  }

  return info;
}

/**
 * 批量填充 —— 所有行统一库存+价格（不依赖文本匹配）
 */
async function batchFillSkuTable(page, stock, groupPrice, singlePrice) {
  logger.step('Batch filling all SKU rows...');

  const rows = page.locator('tr');
  const count = await rows.count();
  let filled = 0;

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();
    if (!text.includes('已启用')) continue;

    const inputs = row.locator('input[placeholder="请输入"]');
    const ic = await inputs.count();
    if (ic < 2) continue;

    const v0 = await inputs.nth(0).inputValue();
    if (v0 !== '' && v0 !== '0' && v0 !== '请输入') continue; // already filled

    try {
      await inputs.nth(0).fill(String(stock));
      await page.waitForTimeout(50);
      await inputs.nth(1).fill(String(groupPrice));
      await page.waitForTimeout(50);
      if (ic >= 3) {
        await inputs.nth(2).fill(String(singlePrice));
        await page.waitForTimeout(50);
      }
      filled++;
    } catch (err) {
      logger.warn(`  Row ${i + 1} fill error: ${err.message}`);
    }
  }

  return filled;
}

/**
 * 检查所有行是否价格一致 → 如果是，使用批量模式
 */
function allSamePrice(skuRows) {
  if (skuRows.length <= 1) return true;
  const first = skuRows[0];
  for (let i = 1; i < skuRows.length; i++) {
    if (skuRows[i].groupPrice !== first.groupPrice ||
        skuRows[i].singlePrice !== first.singlePrice ||
        skuRows[i].stock !== first.stock) {
      return false;
    }
  }
  return true;
}

/**
 * 主入口
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Price Table ===');

  // 滚动到表格区域
  await page.evaluate(() => {
    const table = document.querySelector('table');
    if (table) table.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  // 检查当前 SKU 表状态
  let info = await inspectSkuTable(page);
  logger.info(`SKU table: ${info.length} enabled rows`);

  if (info.length === 0) {
    throw new Error('SKU table has no enabled rows. Did specs get generated?');
  }

  // 打印每行信息
  info.forEach(r => {
    logger.debug(`  Row ${r.row}: ${r.inputs} inputs, vals=[${r.values.join(',')}], text="${r.text.substring(0, 60)}"`);
  });

  const skuRows = product.skuRows;
  logger.info(`Expected ${skuRows.length} data rows`);

  // 判断使用批量模式还是逐行模式
  const useBatch = allSamePrice(skuRows);

  let filled = 0;

  if (useBatch) {
    // === 批量模式：所有行统一价格 ===
    const { stock, groupPrice, singlePrice } = skuRows[0];
    logger.info(`All SKUs same price — using batch mode: 拼${groupPrice} / 单${singlePrice} / 库存${stock}`);
    filled = await batchFillSkuTable(page, stock, groupPrice, singlePrice);

  } else {
    // === 逐行模式：价格不同，按行序匹配 ===
    logger.info('SKU prices differ — filling row by row...');

    const rows = page.locator('tr');
    const totalRows = await rows.count();
    let skuIdx = 0;

    for (let i = 0; i < totalRows && skuIdx < skuRows.length; i++) {
      const row = rows.nth(i);
      const text = await row.innerText();
      if (!text.includes('已启用')) continue;

      const targetSku = skuRows[skuIdx];
      const prices = [targetSku.stock, targetSku.groupPrice, targetSku.singlePrice];

      const inputs = row.locator('input[placeholder="请输入"]');
      const ic = await inputs.count();
      if (ic < 2) { skuIdx++; continue; }

      const v0 = await inputs.nth(0).inputValue();
      if (v0 !== '' && v0 !== '0' && v0 !== '请输入') {
        skuIdx++;
        continue;
      }

      try {
        await inputs.nth(0).fill(prices[0]);
        await page.waitForTimeout(60);
        await inputs.nth(1).fill(prices[1]);
        await page.waitForTimeout(60);
        if (ic >= 3) {
          await inputs.nth(2).fill(prices[2]);
          await page.waitForTimeout(60);
        }
        filled++;
      } catch (err) {
        logger.warn(`  Row ${i + 1} (sku ${skuIdx}) fill error: ${err.message}`);
      }

      skuIdx++;
    }
  }

  await takeScreenshot(page, '09_sku_table_filled');

  // ---- 校验 ----
  info = await inspectSkuTable(page);
  const total = info.length;
  const fullyFilled = info.filter(r => {
    return r.values.length >= 2 &&
           r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
           r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入';
  }).length;

  const missingStock = info.filter(r => !r.values[0] || r.values[0] === '' || r.values[0] === '0' || r.values[0] === '请输入').length;
  const missingPrice = info.filter(r => !r.values[1] || r.values[1] === '' || r.values[1] === '请输入').length;
  const missingSingle = info.filter(r => r.values.length < 3 || !r.values[2] || r.values[2] === '' || r.values[2] === '请输入').length;

  logger.info(`SKU verification: ${fullyFilled}/${total} fully filled`);
  if (missingStock > 0) logger.warn(`  ${missingStock} rows missing stock`);
  if (missingPrice > 0) logger.warn(`  ${missingPrice} rows missing group price`);
  if (missingSingle > 0) logger.warn(`  ${missingSingle} rows missing single price`);

  if (fullyFilled < total) {
    logger.warn(`Not all rows filled! Trying JS fallback for remaining ${total - fullyFilled} rows...`);
    // JS fallback: 直接用 DOM 设值
    await page.evaluate((data) => {
      const rows = document.querySelectorAll('tr');
      let skuIdx = 0;
      for (const row of rows) {
        if (!row.innerText.includes('已启用')) continue;
        const inputs = row.querySelectorAll('input[placeholder="请输入"]');
        if (inputs.length < 2) { skuIdx++; continue; }
        if (inputs[0].value && inputs[0].value !== '0' && inputs[0].value !== '请输入') { skuIdx++; continue; }

        const s = data[skuIdx] || data[0] || { stock: '999', groupPrice: '9.9', singlePrice: '10.9' };
        const vals = [s.stock, s.groupPrice, s.singlePrice];
        for (let j = 0; j < Math.min(inputs.length, 3); j++) {
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          desc.set.call(inputs[j], vals[j]);
          inputs[j].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[j].dispatchEvent(new Event('change', { bubbles: true }));
        }
        skuIdx++;
      }
    }, skuRows);

    // 重新统计
    await page.waitForTimeout(1000);
    info = await inspectSkuTable(page);
    const finalFilled = info.filter(r => {
      return r.values.length >= 2 &&
             r.values[0] && r.values[0] !== '' && r.values[0] !== '0' && r.values[0] !== '请输入' &&
             r.values[1] && r.values[1] !== '' && r.values[1] !== '请输入';
    }).length;
    logger.info(`After JS fallback: ${finalFilled}/${info.length} filled`);
  }
}

module.exports = { fillSkuTable, batchFillSkuTable, inspectSkuTable };
