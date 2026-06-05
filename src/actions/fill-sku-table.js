/**
 * 填写 SKU 价格表 —— 逐行填入库存、拼单价、单买价
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 在行文本中匹配 SKU 数据
 * @param {string} rowText
 * @param {import('../data/product-mapper').SkuRow[]} skuRows
 * @returns {import('../data/product-mapper').SkuRow|null}
 */
function findMatchingSku(rowText, skuRows) {
  for (const sku of skuRows) {
    // 行文本中必须包含这个 SKU 的所有规格值
    const allMatch = sku.specs.every(spec => {
      // 支持部分匹配（因为 "红色" 可能包含在 "红蓝双色混装" 中，小心反向匹配）
      return rowText.includes(spec);
    });
    if (allMatch) return sku;
  }
  return null;
}

/**
 * 使用 Playwright fill() 填写一个 SKU 行
 */
async function fillOneRow(page, row, prices) {
  const inputs = row.locator(config.selectors.skuTable.emptyInput);
  const inputCount = await inputs.count();

  if (inputCount < 2) return false;

  // 检查第一个 input 是否为空或默认值
  const v0 = await inputs.nth(0).inputValue();
  if (v0 !== '' && v0 !== '0' && v0 !== '请输入') {
    return false; // 已经填过
  }

  // prices = [stock, groupPrice, singlePrice]
  await inputs.nth(0).fill(prices[0]);  // 库存
  await page.waitForTimeout(config.timeouts.skuRowFill);
  await inputs.nth(1).fill(prices[1]);  // 拼单价
  await page.waitForTimeout(config.timeouts.skuRowFill);
  if (inputCount >= 3) {
    await inputs.nth(2).fill(prices[2]); // 单买价
    await page.waitForTimeout(config.timeouts.skuRowFill);
  }

  return true;
}

/**
 * JS 回退方式填值（处理 React 不认 fill() 的情况）
 */
async function fillOneRowFallback(page, row, prices) {
  await row.evaluate((el, vals) => {
    const inputs = el.querySelectorAll('input[placeholder="请输入"]');
    if (inputs.length < 2) return;

    const setNative = (inp, val) => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      const setter = desc.set;
      setter.call(inp, val);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    };

    setNative(inputs[0], vals[0]); // stock
    setNative(inputs[1], vals[1]); // group price
    if (inputs.length >= 3) {
      setNative(inputs[2], vals[2]); // single price
    }
  }, prices);

  await page.waitForTimeout(100);
  return true;
}

/**
 * 填写整个 SKU 价格表
 * @param {import('playwright').Page} page
 * @param {import('../data/product-mapper').Product} product
 */
async function fillSkuTable(page, product) {
  logger.step('=== Filling SKU Price Table ===');

  // 确保 SKU 表格区域可见
  try {
    await page.evaluate(() => {
      const table = document.querySelector('table');
      if (table) table.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);
  } catch { /* ignore */ }

  const rows = page.locator(config.selectors.skuTable.rows);
  const rowCount = await rows.count();

  if (rowCount === 0) {
    throw new Error('SKU table has no rows. Did specs get generated?');
  }

  logger.info(`SKU table has ${rowCount} total rows, searching for ${product.skuRows.length} data rows...`);

  let filledCount = 0;
  let skippedCount = 0;
  const failedRows = [];

  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const text = await row.innerText();

    // 只处理启用的行
    if (!text.includes(config.selectors.skuTable.rowFilter)) continue;

    const matchedSku = findMatchingSku(text, product.skuRows);
    if (!matchedSku) {
      skippedCount++;
      continue;
    }

    const prices = [matchedSku.stock, matchedSku.groupPrice, matchedSku.singlePrice];

    // 先尝试 Playwright fill()
    let ok = await fillOneRow(page, row, prices);

    // 如果 fill 没触发（值可能还是旧的），用 JS fallback
    if (!ok) {
      // skip — already filled
      continue;
    }

    // 验证是否填成功
    try {
      const inputs = row.locator(config.selectors.skuTable.emptyInput);
      const vAfter = await inputs.nth(0).inputValue();
      if (vAfter === prices[0] || vAfter === '' || vAfter === '0') {
        // fill 触发了但需要等 React 更新
        // 检查是否需要 fallback
        await page.waitForTimeout(300);
        const vCheck = await inputs.nth(1).inputValue();
        if (vCheck !== prices[1]) {
          // fill didn't stick, use fallback
          await fillOneRowFallback(page, row, prices);
        }
      }
    } catch { /* verification failed, continue */ }

    filledCount++;
  }

  await takeScreenshot(page, '09_sku_table_filled');

  logger.info(`SKU table: ${filledCount} filled, ${skippedCount} skipped`);
  if (filledCount !== product.skuRows.length) {
    logger.warn(`Expected ${product.skuRows.length} fills but only filled ${filledCount}`);
    logger.warn('Some SKU rows may not have been matched. Check Excel spec values vs table row text.');
  }
  if (failedRows.length > 0) {
    logger.error(`Failed rows: ${failedRows.join(', ')}`);
  }
}

module.exports = { fillSkuTable, findMatchingSku, fillOneRow, fillOneRowFallback };
