/**
 * 发布守护 —— 停在提交按钮前，不自动发布
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');
const { jsClickByText } = require('../helpers/js-click');

/**
 * 停止在发布前，可选保存草稿
 * @param {import('playwright').Page} page
 * @param {boolean} autoPublish - 是否自动发布
 */
async function stopBeforePublish(page, autoPublish = false) {
  await takeScreenshot(page, '10_form_complete_before_submit');

  if (autoPublish) {
    logger.step('Auto-publish enabled, clicking submit...');
    const submitBtn = page.locator(config.selectors.footer.submit);

    if (await submitBtn.count() > 0) {
      await submitBtn.click();
      logger.info('Product submitted!');
      await page.waitForTimeout(3000);
      await takeScreenshot(page, '11_publish_result');
      return { status: 'published' };
    }

    // JS fallback
    const clicked = await jsClickByText(page, '提交并上架');
    if (clicked) {
      await page.waitForTimeout(3000);
      await takeScreenshot(page, '11_publish_result');
      return { status: 'published' };
    }

    throw new Error('Submit button not found, cannot publish');
  }

  // ---- 默认行为：停在这里，保存草稿 ----
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════╗');
  logger.info('║  FORM FILLING COMPLETE — NOT PUBLISHED          ║');
  logger.info('║  表单已填写完成，未自动发布                      ║');
  logger.info('║  请人工检查后手动点击"提交并上架"                ║');
  logger.info('║  Use --publish flag to auto-submit              ║');
  logger.info('╚══════════════════════════════════════════════════╝');
  logger.info('');

  // 尝试保存草稿（安全操作，不会发布）
  try {
    const draftBtn = page.locator(config.selectors.footer.saveDraft);

    if (await draftBtn.count() > 0) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => b.innerText && b.innerText.includes('保存草稿'));
        if (btn) btn.click();
      });
      await page.waitForTimeout(2000);
      logger.info('Draft saved (safe, not published)');
    }
  } catch (err) {
    logger.warn(`Could not save draft: ${err.message}`);
  }

  return { status: 'filled_not_published' };
}

module.exports = { stopBeforePublish };
