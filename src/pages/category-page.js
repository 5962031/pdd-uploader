/**
 * 分类选择页 —— 逐级点击类目树 + 调试输出 + 人工辅助模式
 */
const readline = require('readline');
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');

/**
 * 调试：打印当前页面关键信息
 */
async function debugPageState(page, label) {
  const url = page.url();
  logger.debug(`[${label}] Current URL: ${url}`);

  // 打印所有按钮文本
  const btns = await page.evaluate(() => {
    return [...document.querySelectorAll('button')]
      .map(b => b.innerText.trim())
      .filter(Boolean)
      .slice(0, 15);
  });
  logger.debug(`[${label}] Buttons: ${JSON.stringify(btns)}`);

  // 查找包含关键词的元素
  const hits = await page.evaluate(() => {
    const keywords = ['确认', '发布', '类商品', '下一步', '提交', '类目', '分类'];
    const found = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
      const text = (el.innerText || '').trim();
      if (text.length > 2 && text.length < 30 && keywords.some(k => text.includes(k))) {
        found.push(text);
      }
    }
    return [...new Set(found)].slice(0, 20);
  });
  logger.debug(`[${label}] Keyword hits: ${JSON.stringify(hits)}`);
}

/**
 * 查找确认按钮 —— 兼容多种文本
 */
async function findConfirmButton(page) {
  const candidates = [
    '确认发布该类商品',
    '确认发布此类商品',
    '发布该类商品',
    '确认',
    '下一步',
  ];

  for (const text of candidates) {
    const btn = page.locator(`button:has-text("${text}")`).first();
    if (await btn.count() > 0) {
      try {
        const visible = await btn.isVisible();
        if (visible) return { button: btn, text };
      } catch { /* not visible */ }
    }
  }

  // 回退：用 JS 在页面中搜索
  try {
    const found = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const match = btns.find(b => {
        const t = b.innerText || '';
        return t.includes('确认') || t.includes('发布');
      });
      return match ? match.innerText.trim() : null;
    });
    if (found) {
      return { button: page.locator(`button:has-text("${found.substring(0, 8)}")`).first(), text: found };
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * 人工辅助模式：等待用户手动选择类目
 */
async function manualAssist(page) {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════╗');
  logger.info('║  MANUAL ASSIST — 请手动选择类目             ║');
  logger.info('║  在浏览器中逐级点击：                        ║');
  logger.info('║    数码电器                                  ║');
  logger.info('║    文具电教/文化用品/商务用品                ║');
  logger.info('║    纸张本册                                  ║');
  logger.info('║    不干胶标签                                ║');
  logger.info('║  选中后，按 Enter 继续                      ║');
  logger.info('╚══════════════════════════════════════════════╝');
  logger.info('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => {
    rl.question('按 Enter 继续...', () => { rl.close(); resolve(); });
  });

  await takeScreenshot(page, '03_manual_selection');

  // 再找确认按钮
  const result = await findConfirmButton(page);
  if (result) {
    logger.info(`Found confirm button: "${result.text}"`);
    await result.button.click();
    await page.waitForTimeout(3000);
    return true;
  }

  logger.error('Still cannot find confirm button after manual selection');
  await debugPageState(page, 'manual_after');
  await takeScreenshot(page, '03_manual_failed');
  return false;
}

/**
 * 选择商品类目并进入发布表单
 * @param {import('playwright').Page} page
 * @param {string[]} categoryPath - e.g. ['数码电器', '文具电教/...', '纸张本册', '不干胶标签']
 */
async function selectCategory(page, categoryPath) {
  logger.step(`Category path: ${categoryPath.join(' > ')}`);

  // ---- 进入分类页 ----
  await page.goto(config.urls.goodsList, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 点击 "发布新商品"
  const publishLink = page.locator('a:has-text("发布新商品")').first();
  if (await publishLink.count() > 0) {
    await publishLink.click();
    logger.info('Clicked "发布新商品"');
    await page.waitForTimeout(2500);
  } else {
    logger.info('Directly navigating to category page');
    await page.goto(config.urls.goodsCategory, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
  }

  await debugPageState(page, 'category_page_loaded');
  await takeScreenshot(page, '03_category_page');

  // ---- 策略 A: 点击 "最近使用的分类" ----
  let clicked = false;

  // 用更宽松的方式判断：查找包含 "最近使用" 文本的可点击元素
  const recentEls = page.locator('text=最近使用');
  const recentCount = await recentEls.count();
  logger.info(`"最近使用" elements found: ${recentCount}`);

  if (recentCount > 0) {
    logger.step('Trying "最近使用的分类"...');

    // 如果 "最近使用的分类" 下面有直接可点击的路径，点它
    try {
      const pathText = categoryPath.join(' > ');
      const pathEl = page.locator(`text=${categoryPath[categoryPath.length - 1]}`).first();
      if (await pathEl.count() > 0) {
        await pathEl.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        logger.info(`Clicked leaf category directly: ${categoryPath[categoryPath.length - 1]}`);
        clicked = true;
      }
    } catch { /* continue */ }

    // 如果直接点击叶子类目不行，尝试点击 ">" 符号展开
    if (!clicked) {
      try {
        const expandBtn = page.locator('text=最近使用').locator('..').locator('[cursor=pointer]').first();
        if (await expandBtn.count() > 0) {
          await expandBtn.click();
          await page.waitForTimeout(500);
        }
      } catch { /* ignore */ }
    }
  }

  // ---- 策略 B: 逐级点击类目树 ----
  if (!clicked) {
    logger.step('Clicking through category tree level by level...');

    for (let i = 0; i < categoryPath.length; i++) {
      const level = categoryPath[i];
      logger.info(`  Level ${i + 1}: looking for "${level}"`);

      // 尝试直接点击
      let levelClicked = false;

      // 先尝试完整文本匹配
      const fullMatch = page.locator(`text="${level}"`).first();
      if (await fullMatch.count() > 0) {
        try {
          await fullMatch.click({ timeout: 5000 });
          await page.waitForTimeout(800);
          levelClicked = true;
          logger.info(`  ✓ Clicked "${level}" (exact)`);
        } catch { /* try partial */ }
      }

      // 尝试部分匹配（处理带 / 的路径如 "文具电教/文化用品/商务用品"）
      if (!levelClicked && level.includes('/')) {
        for (const part of level.split('/')) {
          const trimmed = part.trim();
          const partMatch = page.locator(`text=${trimmed}`).first();
          if (await partMatch.count() > 0) {
            try {
              await partMatch.click({ timeout: 3000 });
              await page.waitForTimeout(500);
              logger.info(`  ✓ Clicked "${trimmed}" (partial)`);
              levelClicked = true;
            } catch { /* try next part */ }
          }
        }
      }

      // 如果还是点击失败，在页面中寻找包含这个文本的任意元素
      if (!levelClicked) {
        try {
          await page.evaluate((text) => {
            const all = document.querySelectorAll('*');
            for (const el of all) {
              if ((el.innerText || '').trim() === text || (el.innerText || '').includes(text)) {
                el.click();
                return true;
              }
            }
            return false;
          }, level);
          await page.waitForTimeout(800);
          logger.info(`  ✓ Clicked "${level}" (JS fallback)`);
          levelClicked = true;
        } catch { /* continue */ }
      }

      if (!levelClicked) {
        logger.warn(`  ✗ Could not click "${level}"`);
      }

      await takeScreenshot(page, `03_level_${i + 1}_${level.replace(/[/\\]/g, '_').substring(0, 20)}`);
    }

    await takeScreenshot(page, '03_category_selected');
  }

  // ---- 确认发布 ----
  await debugPageState(page, 'before_confirm');
  let confirmResult = await findConfirmButton(page);

  if (confirmResult) {
    logger.info(`Clicking confirm: "${confirmResult.text}"`);
    await confirmResult.button.click();
    await page.waitForTimeout(3000);
  } else {
    // 自动选择失败 → 人工辅助
    logger.warn('Auto-select failed, entering manual assist mode');
    const manualOk = await manualAssist(page);
    if (!manualOk) {
      await debugPageState(page, 'final_failure');
      throw new Error(
        'Cannot find any confirm button on the category page.\n' +
        'Please manually verify the page in the Chrome window and check screenshots.'
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
