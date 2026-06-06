const XLSX = require('xlsx');
const path = require('path');
const wb = XLSX.utils.book_new();

// ---- 商品表 ----
const productsData = [
  { '商品ID': 'label_001', '商品模板': '不干胶标签', '商品标题': '分类贴商品贴不干胶标签贴自粘贴便利贴姓名贴办公用品贴手写贴纸',
    '类目路径': '数码电器>文具电教/文化用品/商务用品>纸张本册>不干胶标签',
    '图片文件夹': '', '主图': '主图', '详情图': '详情图',
    '规格1名称': '款式', '规格1选项': '红蓝双色混装;红色;蓝色',
    '规格2名称': '容量', '规格2选项': '整包50张--1200贴;散装20张--480贴;100张--2400贴',
    '运费模板': '默认模板', '发布模式': '草稿' },
];
const ws1 = XLSX.utils.json_to_sheet(productsData);
ws1['!cols'] = [{wch:15},{wch:15},{wch:50},{wch:50},{wch:20},{wch:10},{wch:10},{wch:10},{wch:25},{wch:10},{wch:25},{wch:12},{wch:10},{wch:20}];
XLSX.utils.book_append_sheet(wb, ws1, '商品表');

// ---- 属性表 ----
const attrsData = [
  { '商品ID': 'label_001', '属性名': '品牌', '属性值': '无品牌' },
  { '商品ID': 'label_001', '属性名': '是否支持定制', '属性值': '不支持定制' },
  { '商品ID': 'label_001', '属性名': '产地', '属性值': '中国大陆' },
  { '商品ID': 'label_001', '属性名': '纸张类型', '属性值': '铜版纸' },
  { '商品ID': 'label_001', '属性名': '形状', '属性值': '矩形' },
  { '商品ID': 'label_001', '属性名': '包装方式', '属性值': '袋装' },
];
const ws2 = XLSX.utils.json_to_sheet(attrsData);
ws2['!cols'] = [{wch:15},{wch:20},{wch:20}];
XLSX.utils.book_append_sheet(wb, ws2, '属性表');

// ---- SKU表 ----
const skuData = [
  { '商品ID':'label_001','款式':'红蓝双色混装','容量':'整包50张--1200贴','库存':999,'拼单价':9.9,'单买价':10.9,'规格编码':'mix_50','SKU预览图':'mix.png' },
  { '商品ID':'label_001','款式':'红蓝双色混装','容量':'散装20张--480贴','库存':999,'拼单价':5.9,'单买价':6.9,'规格编码':'mix_20','SKU预览图':'mix.png' },
  { '商品ID':'label_001','款式':'红蓝双色混装','容量':'100张--2400贴','库存':999,'拼单价':16.9,'单买价':17.9,'规格编码':'mix_100','SKU预览图':'mix.png' },
  { '商品ID':'label_001','款式':'红色','容量':'整包50张--1200贴','库存':999,'拼单价':9.9,'单买价':10.9,'规格编码':'red_50','SKU预览图':'red.png' },
  { '商品ID':'label_001','款式':'红色','容量':'散装20张--480贴','库存':999,'拼单价':5.9,'单买价':6.9,'规格编码':'red_20','SKU预览图':'red.png' },
  { '商品ID':'label_001','款式':'红色','容量':'100张--2400贴','库存':999,'拼单价':16.9,'单买价':17.9,'规格编码':'red_100','SKU预览图':'red.png' },
  { '商品ID':'label_001','款式':'蓝色','容量':'整包50张--1200贴','库存':999,'拼单价':9.9,'单买价':10.9,'规格编码':'blue_50','SKU预览图':'blue.png' },
  { '商品ID':'label_001','款式':'蓝色','容量':'散装20张--480贴','库存':999,'拼单价':5.9,'单买价':6.9,'规格编码':'blue_20','SKU预览图':'blue.png' },
  { '商品ID':'label_001','款式':'蓝色','容量':'100张--2400贴','库存':999,'拼单价':16.9,'单买价':17.9,'规格编码':'blue_100','SKU预览图':'blue.png' },
];
const ws3 = XLSX.utils.json_to_sheet(skuData);
ws3['!cols'] = [{wch:15},{wch:18},{wch:22},{wch:8},{wch:10},{wch:10},{wch:15},{wch:12}];
XLSX.utils.book_append_sheet(wb, ws3, 'SKU表');

// ---- 目录示例 ----
const dirData = [
  { '图片目录': 'D:\\pddtest\\assets\\{图片文件夹}', '说明': '如 assets\\label_001\\' },
  { '图片目录': 'D:\\pddtest\\assets\\{图片文件夹}\\主图\\', '说明': '主图: 1.png, 2.png, 3.png...' },
  { '图片目录': 'D:\\pddtest\\assets\\{图片文件夹}\\详情图\\', '说明': '详情图: 1.jpg, 2.jpg...' },
  { '图片目录': 'D:\\pddtest\\assets\\{图片文件夹}\\SKU图\\', '说明': 'SKU图: mix.png, red.png, blue.png' },
];
const ws4 = XLSX.utils.json_to_sheet(dirData);
XLSX.utils.book_append_sheet(wb, ws4, '目录示例');

// ---- 使用说明 ----
const helpData = [
  { '说明项': '商品ID', '内容': '三张表的关联字段，唯一标识一个商品。如 label_001' },
  { '说明项': '图片文件夹', '内容': '对应 D:\\pddtest\\assets\\ 下的子文件夹名。留空则使用商品ID' },
  { '说明项': '主图', '内容': '填 "主图" 读取 主图\\ 目录。也可填具体文件名如 main1.png;main2.png' },
  { '说明项': '商品模板', '内容': '不干胶标签 / 食品快消 / 日用品 / 通用模板 / 汽车用品' },
  { '说明项': '规格名称', '内容': '可自定义: 款式/容量/颜色/尺寸/口味/规格/套餐/型号/数量' },
  { '说明项': 'SKU预览图', '内容': '填文件名如 red.png。留空自动取 SKU图\\ 下唯一图片' },
  { '说明项': '发布模式', '内容': '草稿(推荐) / 提交上架' },
  { '说明项': '运行命令', '内容': 'npm run dry-run 或 node src/index.js --batch-draft --only=label_001' },
];
const ws5 = XLSX.utils.json_to_sheet(helpData);
XLSX.utils.book_append_sheet(wb, ws5, '使用说明');

const out = path.join(__dirname, '..', 'docs', 'products_中文模板.xlsx');
XLSX.writeFile(wb, out);
console.log('Template written to:', out);
