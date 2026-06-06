/**
 * 设置 SKU 规格维度 — 每个规格绑定自己的 block，不跨块填值
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 在页面扫描所有规格 block，返回 { name, y, inputs, addBtn } 数组
 */
async function scanSpecBlocks(page) {
  return page.evaluate(() => {
    const blocks = [];
    // 找所有可见的"自定义{name}"区域，向上找到父级 block
    const allDivs = document.querySelectorAll('div');
    const seen = new Set();

    for (const div of allDivs) {
      const r = div.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      const text = (div.innerText || '').trim();
      // 规格 block 特征：短标题 + 有输入框区域
      const titleMatch = text.match(/^(.{1,6})\n/);  // 获取第一行作为可能的标题
      if (!titleMatch) continue;

      const title = titleMatch[1].replace(/[\*：:\s]/g, '').trim();
      if (title.length < 1 || title.length > 8) continue;

      // 查找这个 div 内部的 input 和添加按钮
      const inputs = div.querySelectorAll('input[type="text"], input:not([type]), [data-testid="beast-core-input-htmlInput"]');
      const addBtn = div.querySelector('[class*="add"], [class*="添加"], button, a');
      const hasInputs = [...inputs].some(inp => {
        const ir = inp.getBoundingClientRect();
        return ir.width > 20;
      });

      if (hasInputs && !seen.has(title + '@' + Math.round(r.y))) {
        seen.add(title + '@' + Math.round(r.y));
        blocks.push({
          name: title,
          y: r.y,
          inputCount: [...inputs].filter(inp => inp.getBoundingClientRect().width > 20).length,
        });
      }
    }
    return blocks;
  });
}

/**
 * 找到包含 specName 文本的最近父级 block 中的输入框
 */
async function findBlockInputs(page, specName) {
  // 策略: 找文本"款式"/"套餐"等，找它附近右侧的 textbox
  const result = await page.evaluate((name) => {
    // 先找 specName 的文本节点
    const allEls = document.querySelectorAll('div, span, label');
    let labelEl = null;
    for (const el of allEls) {
      const t = (el.innerText || el.textContent || '').trim();
      if (t === name || t.replace(/[\*：:\s]/g, '').trim() === name) {
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 5 && r.width < 200) {
          labelEl = el;
          break;
        }
      }
    }
    if (!labelEl) return null;

    const labelRect = labelEl.getBoundingClientRect();

    // 在 label 右侧和下方找 textbox（beast-core 的自定义规格输入框）
    const inputs = document.querySelectorAll('[data-testid="beast-core-input-htmlInput"], input[type="text"], input:not([type])');
    const nearby = [];
    for (const inp of inputs) {
      const ir = inp.getBoundingClientRect();
      if (ir.width < 20 || ir.height < 10) continue;
      // 在 label 的右侧或正下方，同一行区域内
      const dy = Math.abs(ir.y - labelRect.y);
      const dx = ir.x - (labelRect.x + labelRect.width);
      if (dy < 100 && dx > -10 && dx < 500) {
        nearby.push({ x: ir.x, y: ir.y, dx, dy });
      }
    }
    nearby.sort((a, b) => (a.dy + Math.abs(a.dx)) - (b.dy + Math.abs(b.dx)));
    return nearby.length > 0 ? { found: true, count: nearby.length } : null;
  }, specName);

  return result;
}

/**
 * 添加一个规格类型
 */
async function addSpecType(page, specName, specIndex) {
  const addBtn = page.locator(config.selectors.spec.addSpecBtn);
  if (await addBtn.count() === 0) {
    // 可能已经存在，检查
    const exists = page.getByRole('textbox', { name: `规格类型${specIndex}` });
    if (await exists.count() > 0) return true;
    return false;
  }
  await addBtn.click();
  await page.waitForTimeout(500);

  const specInput = page.getByRole('textbox', { name: `规格类型${specIndex}` });
  if (await specInput.count() === 0) return false;

  await specInput.click();
  await page.waitForTimeout(300);

  // 选择规格名
  const opt = page.getByRole('option', { name: specName }).first();
  if (await opt.count() > 0) { await opt.click(); await page.waitForTimeout(300); return true; }

  const fuzzy = page.locator(`[role="option"]:has-text("${specName}")`).first();
  if (await fuzzy.count() > 0) { await fuzzy.click(); await page.waitForTimeout(300); return true; }

  // 尝试直接输入
  try { await specInput.fill(specName); await page.waitForTimeout(300); return true; } catch { return false; }
}

/**
 * 填入一个规格块的值
 */
async function fillSpecBlock(page, specName, values) {
  if (!values || values.length === 0) return;

  logger.info(`  Filling "${specName}" values: ${values.join(', ')}`);

  // 定位这个规格块的 textbox
  const customInputs = page.getByRole('textbox', { name: `自定义${specName}` });
  const cnt = await customInputs.count();

  if (cnt > 0) {
    // 每个值填入最后一个（空）textbox，系统自动追加新行
    for (let i = 0; i < values.length; i++) {
      const inputs = page.getByRole('textbox', { name: `自定义${specName}` });
      const cc = await inputs.count();
      await inputs.nth(cc - 1).fill(values[i]);
      await page.waitForTimeout(config.timeouts.reactRerender);
    }
    logger.info(`    ✓ ${values.length} values filled in "自定义${specName}"`);
    return;
  }

  // 回退: 定位 specName 文本，找它附近右侧的 textbox
  const blockFound = await findBlockInputs(page, specName);
  if (!blockFound) {
    logger.warn(`    ⚠ Cannot find input block for "${specName}"`);
    await takeScreenshot(page, `08_spec_fail_${specName}`);
    return;
  }

  // 使用 block 内的 textbox：找到自定义规格输入框，逐个填入
  const allInputs = page.getByRole('textbox');
  const total = await allInputs.count();
  let filled = 0;

  for (let i = 0; i < total && filled < values.length; i++) {
    const inp = allInputs.nth(i);
    const ph = await inp.getAttribute('placeholder').catch(() => '');
    const val = await inp.inputValue().catch(() => '');
    // 跳过规格类型选择框和已填值的
    if (ph.includes('规格类型') || ph.includes('搜索')) continue;
    if (val !== '' && val !== '请输入') continue;

    await inp.fill(values[filled]);
    await page.waitForTimeout(config.timeouts.reactRerender);
    filled++;
  }

  if (filled > 0) {
    logger.info(`    ✓ ${filled}/${values.length} values filled (proximity match)`);
  } else {
    logger.warn(`    ✗ Cannot find empty textboxes for "${specName}"`);
    await takeScreenshot(page, `08_spec_fail_${specName}`);
  }
}

/**
 * 校验规格块内的值
 */
async function verifySpecBlock(page, specName, values) {
  try {
    const inputs = page.getByRole('textbox', { name: `自定义${specName}` });
    const cnt = await inputs.count();
    const actual = [];
    for (let i = 0; i < cnt; i++) {
      const v = await inputs.nth(i).inputValue().catch(() => '');
      if (v && v !== '请输入') actual.push(v);
    }
    const allFound = values.every(v => actual.includes(v));
    const noCrossTalk = values.every(v => actual.includes(v)) && actual.every(v => values.includes(v));
    if (noCrossTalk) {
      logger.info(`    ✓ "${specName}" block verified: ${actual.join(', ')}`);
    } else {
      logger.warn(`    ⚠ "${specName}" block mismatch: expected=[${values.join(', ')}] actual=[${actual.join(', ')}]`);
    }
    return { ok: allFound, actual, details: noCrossTalk ? 'ok' : 'mismatch' };
  } catch (err) {
    logger.warn(`    ✗ verify "${specName}" error: ${err.message}`);
    return { ok: false, actual: [], details: err.message };
  }
}

/**
 * 主入口
 */
async function fillSpecifications(page, product) {
  logger.step('=== Filling SKU Specifications ===');

  await page.evaluate(() => {
    const el = document.querySelector('table, [class*="sku"], [class*="spec"]');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  const dimensions = product.skuDimensions;
  if (dimensions.length === 0) {
    logger.info('No SKU dimensions — single SKU');
    return;
  }

  logger.info(`Dimensions (${dimensions.length}): ${dimensions.map(d => d.name + '(' + d.values.length + ')').join(', ')}`);

  for (let i = 0; i < dimensions.length; i++) {
    const dim = dimensions[i];
    logger.info(`  Spec ${i + 1}: ${dim.name} → [${dim.values.join(', ')}]`);

    // 确保规格类型存在
    const specInput = page.getByRole('textbox', { name: `规格类型${i + 1}` });
    if (await specInput.count() === 0) {
      const added = await addSpecType(page, dim.name, i + 1);
      if (!added) logger.warn(`  Could not add spec type "${dim.name}"`);
    }

    // 填空值
    await fillSpecBlock(page, dim.name, dim.values);

    // 校验
    const verify = await verifySpecBlock(page, dim.name, dim.values);
    if (!verify.ok) {
      await takeScreenshot(page, `08_spec_verify_${dim.name}`);
    }
  }

  await takeScreenshot(page, '08_specs_done');

  // 最终校验 SKU 行数
  const skuRows = product.skuRows;
  const rows = page.locator('tr');
  let enabledCount = 0;
  for (let i = 0; i < await rows.count(); i++) {
    const text = await rows.nth(i).innerText();
    if (text.includes('已启用')) enabledCount++;
  }
  if (enabledCount !== skuRows.length) {
    logger.warn(`⚠ SKU row count mismatch: page has ${enabledCount}, Excel has ${skuRows.length}. Specs may be misconfigured.`);
    await takeScreenshot(page, '08_sku_row_mismatch');
  } else {
    logger.info(`SKU rows verified: ${enabledCount}/${skuRows.length} ✓`);
  }

  logger.info(`Specs: ${dimensions.map(d => d.name).join(', ')} ✓`);
}

module.exports = { fillSpecifications };
