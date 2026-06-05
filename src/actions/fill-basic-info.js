/**
 * 填写基本信息：标题 + 主图上传 + 详情图
 */
const config = require('../config');
const logger = require('../helpers/logger');
const { takeScreenshot } = require('../helpers/screenshot');
const fs = require('fs');

/**
 * 填写商品标题
 */
async function fillTitle(page, title) {
  logger.step(`Filling title: ${title.substring(0, 40)}...`);

  // 尝试多种选择器定位标题输入框
  let titleInput = page.locator('textarea[placeholder*="标题"], input[placeholder*="标题"]').first();

  if (await titleInput.count() === 0) {
    titleInput = page.getByRole('textbox').filter({ hasText: '' }).first();
  }

  if (await titleInput.count() === 0) {
    throw new Error('Title input not found. Cannot proceed.');
  }

  await titleInput.fill(title);
  await page.waitForTimeout(config.timeouts.reactRerender);
  logger.info('Title filled');
}

/**
 * 上传主图（10张以内）
 */
async function fillMainImages(page, mainImages) {
  if (!mainImages || mainImages.length === 0) {
    logger.warn('No main images to upload');
    return;
  }

  logger.step(`Uploading ${mainImages.length} main images...`);

  // 验证文件存在
  const validImages = mainImages.filter(f => {
    const exists = fs.existsSync(f);
    if (!exists) logger.warn(`  Image not found: ${f}`);
    return exists;
  });

  if (validImages.length === 0) {
    throw new Error('No valid main image files found. Check paths in Excel.');
  }

  // 找到主图上传 input
  const fileInput = page.locator('input[type=file]').first();
  await fileInput.setInputFiles(validImages);
  await page.waitForTimeout(3000);

  logger.info(`Uploaded ${validImages.length} main images`);
  await takeScreenshot(page, '06_main_images_uploaded');
}

/**
 * 填写基本信息（标题 + 主图）
 */
async function fillBasicInfo(page, product) {
  logger.step('=== Filling Basic Info ===');

  // 点击侧边栏 "基本信息" 确保区域可见
  try {
    const sidebar = page.locator(config.selectors.sidebar.specStock);
    if (await sidebar.count() > 0) {
      // 先滚动到顶部
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
    }
  } catch { /* ignore */ }

  await fillTitle(page, product.title);
  await fillMainImages(page, product.mainImages);

  await takeScreenshot(page, '05_basic_info_filled');
  logger.info('Basic info complete');
}

module.exports = { fillBasicInfo, fillTitle, fillMainImages };
