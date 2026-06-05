/**
 * pdd-uploader 主入口
 *
 * 用法:
 *   npm run dry-run            # 干跑校验
 *   npm run run                # 单个商品，填完停住
 *   npm run batch              # 批量模式
 *   npm run run:label          # 指定 label_001
 *   npm run publish            # 自动发布
 */
// ═══════════════════════════════════════════════
// 最先加载 .env.local（必须在其他模块之前）
// ═══════════════════════════════════════════════
require('dotenv').config({ path: '.env.local' });

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./helpers/logger');
const { takeScreenshot } = require('./helpers/screenshot');
const { launchBrowser } = require('./browser/launcher');
const { restoreSession, saveSession, waitForLogin } = require('./browser/session');
const { readWorkbook } = require('./data/excel-reader');
const { mapProduct } = require('./data/product-mapper');
const { validateProduct } = require('./data/validator');
const { resolveCategoryPath } = require('./data/category-map');
const { selectCategory } = require('./pages/category-page');
const { fillBasicInfo } = require('./actions/fill-basic-info');
const { fillAttributes } = require('./actions/fill-attributes');
const { fillSpecifications } = require('./actions/fill-specs');
const { fillSkuTable } = require('./actions/fill-sku-table');
const { stopBeforePublish } = require('./pages/submit-guard');

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    publish: args.includes('--publish'),
    verbose: args.includes('--verbose'),
    productId: args.find(a => a.startsWith('--product='))?.split('=')[1] || null,
    skipLogin: args.includes('--skip-login'),
    batch: args.includes('--batch'),
    dryRun: args.includes('--dry-run'),
  };
}

/**
 * 等待用户按回车继续
 */
function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt || '\n按 Enter 继续下一个，输入 q 退出: ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * 处理单个商品
 */
async function processOneProduct(page, product, args) {
  // ---- 校验 ----
  logger.step(`=== Validating: ${product.productId} ===`);
  const validation = validateProduct(product);

  if (!validation.valid) {
    logger.error(`Product "${product.productId}" has ${validation.errors.length} error(s):`);
    validation.errors.forEach(e => logger.error(`  ❌ [${e.field}] ${e.message}`));
    if (args.dryRun) return { status: 'validation_failed' };

    logger.error('Cannot proceed with invalid product. Fix Excel data and retry.');
    return { status: 'validation_failed', errors: validation.errors };
  }

  if (validation.warnings.length > 0) {
    logger.warn(`${validation.warnings.length} warning(s) — continuing anyway`);
  }

  if (args.dryRun) {
    logger.info(`[DRY RUN] "${product.productId}" validation PASSED — would upload`);
    return { status: 'dry_run_ok' };
  }

  // ---- 解析类目 ----
  logger.step(`=== Category for: ${product.productId} ===`);
  const categoryPath = resolveCategoryPath(product);

  // ---- 选择类目 → 返回商品表单页 ----
  const formPage = await selectCategory(page.context(), page, categoryPath);

  // ---- 填写基本信息 ----
  await fillBasicInfo(formPage, product);

  // ---- 填写属性 ----
  await fillAttributes(formPage, product);

  // ---- 设置规格 ----
  await fillSpecifications(formPage, product);

  // ---- 填写 SKU 价格表 ----
  await fillSkuTable(formPage, product);

  // ---- 停止在发布之前 ----
  const result = await stopBeforePublish(formPage, args.publish);

  return result;
}

/**
 * 批量模式：逐个处理Excel中所有商品
 */
async function batchMode(page, products, workbook, args) {
  logger.info(`\n=== BATCH MODE: ${products.length} products ===\n`);

  const results = [];

  for (let i = 0; i < products.length; i++) {
    const raw = products[i];
    const product = mapProduct(raw, workbook.attributes, workbook.sku);

    logger.info(`\n${'═'.repeat(50)}`);
    logger.info(`Product ${i + 1}/${products.length}: ${product.productId}`);
    logger.info(`Title: ${product.title.substring(0, 50)}...`);
    logger.info(`${'═'.repeat(50)}`);

    // 处理
    const result = await processOneProduct(page, product, args);
    results.push({ productId: product.productId, ...result });

    // 最后一个不等待
    if (i < products.length - 1) {
      const answer = await waitForEnter(`\n✅ ${product.productId} 完成 (${result.status})。`);
      if (answer === 'q') {
        logger.info('User quit batch mode');
        break;
      }
    }
  }

  // 汇总
  logger.info(`\n=== BATCH SUMMARY ===`);
  results.forEach(r => {
    const icon = r.status === 'filled_not_published' ? '✅' :
                 r.status === 'published' ? '🚀' :
                 r.status === 'validation_failed' ? '❌' : '⚠️';
    logger.info(`  ${icon} ${r.productId}: ${r.status}`);
  });

  return results;
}

/**
 * 主流程
 */
async function main() {
  const args = parseArgs();

  logger.info('╔══════════════════════════════════════╗');
  logger.info('║     PDD Uploader v1.1.0             ║');
  logger.info('║  拼多多商家后台商品发布自动化        ║');
  logger.info('╚══════════════════════════════════════╝');

  // ---- Step 1: 读取商品数据 ----
  logger.step('=== Step 1: Reading Excel ===');
  const workbook = readWorkbook(config.paths.excel);

  if (workbook.products.length === 0) {
    throw new Error(`No products found in ${config.paths.excel}`);
  }

  logger.info(`Found ${workbook.products.length} product(s), ${workbook.attributes.length} attribute(s), ${workbook.sku.length} SKU row(s)`);

  // ---- Dry-run 模式：只校验，不打开浏览器 ----
  if (args.dryRun) {
    logger.info('\n=== DRY RUN MODE ===');
    workbook.products.forEach((raw, i) => {
      const product = mapProduct(raw, workbook.attributes, workbook.sku);
      const v = validateProduct(product);
      const icon = v.valid ? '✅' : '❌';
      logger.info(`${icon} [${i + 1}] ${product.productId}: ${product.title.substring(0, 40)} | ${product.skuRows.length} SKUs | ${product.attributes.length} attrs | ${product.skuDimensions.length} dims`);
      // 检查 SKU 预览图
      product.skuRows.forEach((r, j) => {
        const imgPath = r.previewImage;
        const exists = imgPath ? fs.existsSync(imgPath) : false;
        if (!exists && imgPath) {
          logger.warn(`    ⚠️ SKU${j + 1} preview image missing: ${imgPath}`);
        }
      });
      const previewCount = product.skuRows.filter(r => r.previewImage && fs.existsSync(r.previewImage)).length;
      logger.info(`    SKU previews: ${previewCount}/${product.skuRows.length} found`);
      v.errors.forEach(e => logger.error(`    ❌ ${e.field}: ${e.message}`));
      v.warnings.forEach(w => logger.warn(`    ⚠️ ${w.field}: ${w.message}`));
    });
    return;
  }

  // ---- Step 2: 启动浏览器 ----
  logger.step('=== Step 2: Launching Browser ===');
  const { browser, context, page } = await launchBrowser();

  // ---- Step 3: 登录 ----
  logger.step('=== Step 3: Login ===');
  const sessionOk = await restoreSession(context, page);

  if (!sessionOk) {
    await waitForLogin(page);
    await saveSession(context);
  }

  // ---- Step 4-9: 处理商品 ----
  if (args.batch) {
    await batchMode(page, workbook.products, workbook, args);
  } else {
    // 单个商品
    let product;
    if (args.productId) {
      const raw = workbook.products.find(r => {
        const vals = Object.values(r);
        return vals.some(v => String(v).includes(args.productId));
      });
      if (!raw) throw new Error(`Product "${args.productId}" not found in Excel`);
      product = mapProduct(raw, workbook.attributes, workbook.sku);
    } else {
      product = mapProduct(workbook.products[0], workbook.attributes, workbook.sku);
      logger.info(`Using first product: ${product.productId}`);
    }

    await processOneProduct(page, product, args);
  }

  logger.info('');
  logger.info('Done! Browser stays open — close it manually when ready.');
  logger.info(`Screenshots: ${config.paths.screenshots}`);
}

// 启动
main().catch(async (err) => {
  logger.error(`FATAL: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});
