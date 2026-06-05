/**
 * 分类选择页 —— 逐级点击类目树 + 调试输出 + 严格校验 + 人工辅助
 */
const readline = require('readline');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

// ═══════════════════════════════════════════════
// 仅允许这些文本作为"确认发布"按钮
// ═══════════════════════════════════════════════
const CONFIRM_TEXTS = [
  '确认发布该类商品',
  '确认发布此类商品',
  '确认发布这类商品',
  '确认发布',
];

// ═══════════════════════════════════════════════
// 禁止匹配的文本（这些不是确认按钮）
// ═══════════════════════════════════════════════
const FORBIDDEN_CONTAINS = [
  '发布新商品',
  '发布机会商品',
  '发布同款',
  '发布相似品',
];

/**
 * 调试：打印页面底部按钮（含确认按钮区域）
 */
async function debugPageState(page, label) {
  const url = page.url();
  logger.debug(`[${label}] URL: ${url}`);

  // 打印所有可见按钮（扩大到80）
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')]
      .filter(b => b.offsetHeight > 0)  // 只取可见的
      .map(b => (b.innerText || '').trim())
      .filter(Boolean);
  });
  logger.debug(`[${label}] Visible buttons (${btns.length}): ${JSON.stringify(btns)}`);

  // 特别打印包含 "确认" 的元素
  const confirmHits = await page.evaluate(() => {
    return [...document.querySelectorAll('button, a, span, div')]
      .filter(el => el.offsetHeight > 0 && (el.innerText || '').includes('确认'))
      .map(el => (el.innerText || '').trim().substring(0, 60))
      .filter(Boolean);
  });
  logger.debug(`[${label}] Elements with "确认": ${JSON.stringify(confirmHits)}`);
}

/**
 * 读取页面底部"已选分类"区域
 */
async function readSelectedCategory(page) {
  try {
    const text = await page.evaluate(() => {
      // 尝试多种方式读取已选分类
      // PDD 的分类页在底部或顶部面包屑显示当前选择
      const selectors = [
        '[class*="selected"]',
        '[class*="breadcrumb"]',
        '[class*="crumb"]',
        '[class*="path"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText) {
          const t = el.innerText.trim();
          if (t.length > 2 && t.length < 200) return t;
        }
      }
      // 回退：在 body 文本中找类目路径
      const body = document.body.innerText;
      const lines = body.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // PDD 类目路径特征：包含 > 或 文具/数码/家居 等关键词
        if (trimmed.includes('>') && trimmed.length < 100) {
          if (/文具|数码|家居|服饰|母婴|食品/.test(trimmed)) return trimmed;
        }
      }
      return null;
    });

    if (text) {
      logger.info(`  Current selection: "${text}"`);
    } else {
      logger.warn('  Could not read selected category from page');
    }
    return text || '';
  } catch (err) {
    logger.warn(`  readSelectedCategory error: ${err.message}`);
    return '';
  }
}

/**
 * 查找确认按钮 —— 严格匹配，排除干扰项
 */
async function findConfirmButton(page) {
  const allBtns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')]
      .filter(b => b.offsetHeight > 0)
      .map(b => ({
        text: (b.innerText || '').trim(),
        disabled: b.disabled || false,
      }));
  });

  logger.debug(`  Scanning ${allBtns.length} visible buttons for confirm...`);

  // 先从允许列表中找
  for (const ct of CONFIRM_TEXTS) {
    const match = allBtns.find(b => b.text === ct && !b.disabled);
    if (match) {
      logger.debug(`  Found exact match: "${match.text}"`);

      // 验证不是禁止的按钮
      const isForbidden = FORBIDDEN_CONTAINS.some(f => match.text.includes(f));
      if (isForbidden) {
        logger.debug(`  Skipped forbidden button: "${match.text}"`);
        continue;
      }

      return {
        button: page.locator(`button:has-text("${ct}")`).first(),
        text: match.text,
      };
    }
  }

  // 再尝试包含匹配（更宽松）
  for (const ct of CONFIRM_TEXTS) {
    const match = allBtns.find(b =>
      b.text.includes(ct) &&
      !b.disabled &&
      !FORBIDDEN_CONTAINS.some(f => b.text.includes(f))
    );
    if (match) {
      logger.debug(`  Found partial match: "${match.text}"`);
      return {
        button: page.locator(`button:has-text("${ct.substring(0, 6)}")`).first(),
        text: match.text,
      };
    }
  }

  logger.warn('  No confirm button found in visible buttons');
  return null;
}

/**
 * 人工辅助模式
 */
async function manualAssist(page, expectedLeaf) {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════╗');
  logger.info('║  MANUAL ASSIST — 请手动选择类目             ║');
  logger.info(`║  目标: ... > ${expectedLeaf}                  ║`);
  logger.info('║  请在浏览器中逐级点击选择正确类目            ║');
  logger.info('║  选好后按 Enter 继续                        ║');
  logger.info('╚══════════════════════════════════════════════╝');
  logger.info('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('按 Enter 继续...', () => { rl.close(); resolve(); });
  });

  await takeScreenshot(page, '03_manual_selection');

  // 验证已选类目
  const selected = await readSelectedCategory(page);
  if (selected && (selected.includes(expectedLeaf) || expectedLeaf.includes(selected.split('>').pop()?.trim() || ''))) {
    logger.info(`Category verified: "${selected}" includes "${expectedLeaf}" ✓`);
  } else {
    logger.warn(`Category may not be correct. Selected: "${selected}", expected leaf: "${expectedLeaf}"`);
    logger.info('Proceeding anyway — please verify in the browser.');
  }

  // 找确认按钮
  const result = await findConfirmButton(page);
  if (result) {
    logger.info(`Clicking confirm: "${result.text}"`);
    await result.button.click();
    await page.waitForTimeout(3000);
    return true;
  }

  logger.error('Still cannot find confirm button');
  await debugPageState(page, 'manual_failed');
  await takeScreenshot(page, '03_manual_failed');
  return false;
}

/**
 * 在页面中点击匹配文本的元素（返回 true/false，不假成功）
 */
async function clickByText(page, text) {
  // 先尝试 Playwright click
  const exactLocator = page.locator(`text="${text}"`).first();
  if (await exactLocator.count() > 0) {
    try {
      await exactLocator.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      return true;
    } catch { /* fall through to JS */ }
  }

  // 尝试部分匹配
  const fuzzyLocator = page.locator(`text=${text}`).first();
  if (await fuzzyLocator.count() > 0 && text.length > 2) {
    try {
      await fuzzyLocator.click({ timeout: 3000 });
      await page.waitForTimeout(800);
      return true;
    } catch { /* fall through to JS */ }
  }

  // JS fallback —— 必须返回 true 才算成功
  const jsResult = await page.evaluate((targetText) => {
    // 精确匹配优先
    const all = document.querySelectorAll('div, span, li, a, button, td, th, p');
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      // 精确匹配
      if (t === targetText) {
        el.click();
        return 'exact';
      }
    }
    // 包含匹配
    for (const el of all) {
      const t = (el.innerText || el.textContent || '').trim();
      if (t.includes(targetText) && t.length < targetText.length + 10) {
        el.click();
        return 'contains';
      }
    }
    return false;
  }, text);

  if (jsResult) {
    logger.debug(`  JS fallback matched: "${text}" (${jsResult})`);
    await page.waitForTimeout(800);
    return true;
  }

  return false;
}

/**
 * 选择商品类目并进入发布表单
 */
async function selectCategory(page, categoryPath) {
  const expectedLeaf = categoryPath[categoryPath.length - 1];
  logger.step(`Category: ${categoryPath.join(' > ')}`);

  // ---- 进入分类页 ----
  await page.goto(config.urls.goodsList, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const publishLink = page.locator('a:has-text("发布新商品")').first();
  if (await publishLink.count() > 0) {
    await publishLink.click();
    logger.info('Clicked "发布新商品"');
    await page.waitForTimeout(2500);
  } else {
    await page.goto(config.urls.goodsCategory, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
  }

  await debugPageState(page, 'category_page');
  await takeScreenshot(page, '03_category_page');

  // ---- 尝试 "最近使用的分类" ----
  const recentCount = await page.locator('text=最近使用').count();
  logger.info(`"最近使用" elements: ${recentCount}`);

  let autoSelectOk = false;

  if (recentCount > 0) {
    logger.step('Trying recent category...');
    // 直接点击类目叶子节点
    const leafClicked = await clickByText(page, expectedLeaf);
    if (leafClicked) {
      logger.info(`✓ Clicked recent leaf: "${expectedLeaf}"`);
      autoSelectOk = true;
    }
  }

  // ---- 逐级点击 ----
  if (!autoSelectOk) {
    logger.step('Clicking tree level by level...');

    let allLevelsClicked = true;
    for (let i = 0; i < categoryPath.length; i++) {
      const level = categoryPath[i];
      logger.info(`  Level ${i + 1}/4: "${level}"`);

      let clicked = false;

      // 处理含 / 的路径（如 "文具电教/文化用品/商务用品"）
      if (level.includes('/')) {
        for (const part of level.split('/')) {
          const trimmed = part.trim();
          const ok = await clickByText(page, trimmed);
          if (ok) {
            logger.info(`    ✓ Clicked "${trimmed}"`);
            clicked = true;
          } else {
            logger.warn(`    ✗ Failed to click "${trimmed}"`);
          }
          await page.waitForTimeout(300);
        }
      } else {
        clicked = await clickByText(page, level);
        if (clicked) {
          logger.info(`    ✓ Clicked "${level}"`);
        } else {
          logger.warn(`    ✗ Failed to click "${level}"`);
        }
      }

      if (!clicked) allLevelsClicked = false;

      await takeScreenshot(page, `03_level_${i + 1}`);
      await page.waitForTimeout(300);
    }

    if (allLevelsClicked) {
      autoSelectOk = true;
    }
  }

  // ---- 验证已选类目 ----
  await page.waitForTimeout(500);
  const selected = await readSelectedCategory(page);
  const isCorrect = selected.includes(expectedLeaf) || expectedLeaf.includes(selected.split('>').pop()?.trim() || '');

  if (isCorrect) {
    logger.info(`Category verified ✓ — "${selected}"`);
    autoSelectOk = true;
  } else {
    logger.warn(`Category mismatch! Selected: "${selected}", expected leaf: "${expectedLeaf}"`);
    autoSelectOk = false;
  }

  // ---- 确认按钮 ----
  await debugPageState(page, 'before_confirm');
  let confirmResult = await findConfirmButton(page);

  if (confirmResult && autoSelectOk && isCorrect) {
    logger.info(`Clicking confirm: "${confirmResult.text}"`);
    await takeScreenshot(page, '03_category_selected');
    await confirmResult.button.click();
    await page.waitForTimeout(3000);
  } else {
    // 进入人工辅助
    if (!autoSelectOk || !isCorrect) {
      logger.warn('Auto category select failed or incorrect — entering manual assist');
    } else {
      logger.warn('No confirm button found — entering manual assist');
    }

    const manualOk = await manualAssist(page, expectedLeaf);
    if (!manualOk) {
      await debugPageState(page, 'final_failure');
      await takeScreenshot(page, '03_final_failure');
      throw new Error(
        'Category selection failed.\n' +
        `Expected leaf: "${expectedLeaf}"\n` +
        `Selected: "${selected}"\n` +
        'Please check the Chrome window and screenshots in logs/screenshots/.'
      );
    }
  }

  // ---- 等待发布表单加载 ----
  try {
    await page.waitForFunction(
      () => window.location.href.includes('goods_add') || window.location.href.includes('goods_id'),
      { timeout: 10000 }
    );
  } catch {
    const finalUrl = page.url();
    await takeScreenshot(page, '04_form_load_failed');
    throw new Error(`Form page did not load. Still at: ${finalUrl}`);
  }

  await takeScreenshot(page, '04_form_loaded');
  logger.info('Category selected, form loaded ✓');
}

module.exports = { selectCategory };
