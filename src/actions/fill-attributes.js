/**
 * 填写商品属性 —— 扫描页面属性行，按 Excel attributes 表逐项匹配填写
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 扫描页面上所有属性行
 * 返回 [{ label, text, elIndex, inputType }]
 */
async function scanPageAttributeRows(page) {
  return page.evaluate(() => {
    const rows = [];

    // 策略：找所有包含 "*" 标记的属性行（PDD 属性区结构）
    const allDivs = document.querySelectorAll('div');
    const seen = new Set();

    for (const div of allDivs) {
      const text = (div.innerText || '').trim();
      // 跳过非属性区：太短或太长
      if (text.length < 2 || text.length > 25) continue;
      // 跳过纯数字、纯符号
      if (/^[\d.,%\s]+$/.test(text)) continue;

      // 看 div 内部结构：是否有 select input 或 text input
      const select = div.querySelector('[data-testid="beast-core-select-htmlInput"]');
      const textInput = div.querySelector('input[type="text"], input:not([type])');
      const placeholder = select?.placeholder || textInput?.placeholder || '';
      const hasSelect = !!select;
      const hasTextInput = !!textInput && (placeholder.includes('品牌') || placeholder.includes('搜索') || placeholder.includes('请'));

      if (hasSelect || hasTextInput) {
        // 获取 label（去掉 * 等符号）
        let label = text;
        // 如果有子元素，取第一个文本节点的前几个字作为 label
        const children = div.children;
        if (children.length > 0) {
          const firstChildText = (children[0].innerText || '').trim();
          if (firstChildText && firstChildText.length < 15) {
            label = firstChildText.replace(/\*/g, '').trim();
          }
        }
        label = label.replace(/\*/g, '').trim();

        if (!seen.has(label) && label.length < 15) {
          seen.add(label);
          rows.push({
            label: label,
            fullText: text,
            inputType: hasSelect ? 'select' : (hasTextInput ? 'text' : 'unknown'),
            hasSelect,
            hasTextInput,
          });
        }
      }
    }

    // 补充：找"品牌"这种单独一行的
    const brandInput = document.querySelector('input[placeholder*="品牌"]');
    if (brandInput) {
      const parent = brandInput.closest('div');
      const parentText = (parent?.innerText || '').trim();
      const label = parentText.split('\n')[0]?.replace(/\*/g, '').trim() || '品牌';
      if (!seen.has(label)) {
        rows.push({ label, fullText: parentText, inputType: 'text', hasSelect: false, hasTextInput: true });
      }
    }

    return rows;
  });
}

/**
 * 填写一个选择框属性
 */
async function fillSelectRow(page, rowInfo, value) {
  const v = String(value).trim();
  if (!v) return false;

  try {
    // 通过 label 文本找到包含它的属性行
    const allDivs = page.locator('div');
    const cnt = await allDivs.count();

    for (let i = 0; i < cnt; i++) {
      const div = allDivs.nth(i);
      const text = await div.innerText();
      if (!text.includes(rowInfo.label)) continue;
      if (text.length > 60) continue; // 不是属性行

      // 在这一行里找 select
      const select = div.locator('[data-testid="beast-core-select-htmlInput"]').first();
      if (await select.count() === 0) continue;

      await select.click();
      await page.waitForTimeout(300);

      // 选值
      const opt = page.getByRole('option', { name: v }).first();
      if (await opt.count() > 0) {
        await opt.click();
        logger.info(`  ✓ "${rowInfo.label}" → "${v}"`);
        return true;
      }

      // 包含匹配
      const fuzzy = page.locator(`[role="option"]:has-text("${v}")`).first();
      if (await fuzzy.count() > 0) {
        await fuzzy.click();
        logger.info(`  ✓ "${rowInfo.label}" → "${v}" (fuzzy)`);
        return true;
      }

      await page.keyboard.press('Escape');
      logger.warn(`  ✗ "${rowInfo.label}" — option "${v}" not in dropdown`);
      return false;
    }

    logger.warn(`  ✗ "${rowInfo.label}" — row element not found in page`);
    return false;
  } catch (err) {
    logger.warn(`  ✗ "${rowInfo.label}" error: ${err.message}`);
    return false;
  }
}

/**
 * 填写文本输入属性（品牌等）
 */
async function fillTextRow(page, rowInfo, value) {
  const v = String(value).trim();
  if (!v) return false;

  try {
    // 找品牌输入框
    const input = page.locator('input[placeholder*="品牌"]').first();
    if (await input.count() > 0) {
      await input.fill(v);
      await page.waitForTimeout(500);
      // 品牌可能需要从下拉结果中选
      const dropdown = page.locator('[role="option"]:has-text("' + v + '")').first();
      if (await dropdown.count() > 0) {
        await dropdown.click();
        await page.waitForTimeout(300);
      }
      logger.info(`  ✓ "${rowInfo.label}" → "${v}"`);
      return true;
    }

    logger.warn(`  ✗ "${rowInfo.label}" — text input not found`);
    return false;
  } catch (err) {
    logger.warn(`  ✗ "${rowInfo.label}" error: ${err.message}`);
    return false;
  }
}

/**
 * 主入口
 */
async function fillAttributes(page, product) {
  logger.step('=== Filling Attributes ===');

  const attrs = product.attributes || [];
  if (attrs.length === 0) {
    logger.info('No attributes in Excel — skipping');
    return;
  }

  logger.info(`Excel attributes: ${attrs.length} row(s)`);

  // 滚动到属性区域
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find(e =>
      e.innerText === '商品属性' && e.offsetHeight > 0);
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);

  // 扫描页面属性行
  const pageRows = await scanPageAttributeRows(page);
  logger.info(`Page attribute rows detected: ${pageRows.length}`);
  pageRows.forEach(r => logger.debug(`  [${r.inputType}] "${r.label}"`));

  if (pageRows.length === 0) {
    logger.warn('No attribute rows detected on page');
    logger.info('Page may not require attributes for this category — continuing');
    await takeScreenshot(page, '06_attributes_empty');
    return;
  }

  let filled = 0;
  let skipped = 0;

  for (const attr of attrs) {
    // 在页面属性行中找匹配
    const match = pageRows.find(r =>
      r.label === attr.name ||
      r.label.includes(attr.name) ||
      attr.name.includes(r.label)
    );

    if (!match) {
      logger.warn(`  ⚠ "${attr.name}" → not on page (page has: ${pageRows.map(r => r.label).join(', ')})`);
      skipped++;
      continue;
    }

    let ok = false;
    if (match.inputType === 'select') {
      ok = await fillSelectRow(page, match, attr.value);
    } else {
      ok = await fillTextRow(page, match, attr.value);
    }

    if (ok) filled++;
    else skipped++;

    await page.waitForTimeout(200);
  }

  await takeScreenshot(page, '07_attributes_filled');
  logger.info(`Attributes: ${filled} filled, ${skipped} skipped (of ${attrs.length} total)`);
}

module.exports = { fillAttributes, scanPageAttributeRows };
