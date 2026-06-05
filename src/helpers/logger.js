/**
 * 结构化日志 —— 同时输出到控制台和文件
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, `run-${Date.now()}.log`);

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, data = null) {
  const line = `[${timestamp()}] [${level}] ${message}`;
  console.log(line);
  if (data) {
    const extra = JSON.stringify(data, null, 2);
    console.log(extra);
  }
  // 追加到文件
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    if (data) fs.appendFileSync(LOG_FILE, JSON.stringify(data) + '\n');
  } catch (_) { /* 忽略写入失败 */ }
}

module.exports = {
  info: (msg, data) => log('INFO', msg, data),
  warn: (msg, data) => log('WARN', msg, data),
  error: (msg, data) => log('ERROR', msg, data),
  step: (msg) => log('STEP', msg),
  debug: (msg, data) => log('DEBUG', msg, data),
};
