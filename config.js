import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

/**
 * 读取配置：系统环境变量优先，其次读取项目根目录下的 .env。
 * 访问密钥只在服务端内存中使用，永远不会下发给浏览器。
 */
function readDotEnv() {
  const file = path.join(ROOT_DIR, '.env');
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

export function loadConfig() {
  const fileEnv = readDotEnv();
  const pick = (key, fallback = '') => {
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && String(fromProcess).trim() !== '') return String(fromProcess).trim();
    const fromFile = fileEnv[key];
    if (fromFile !== undefined && String(fromFile).trim() !== '') return String(fromFile).trim();
    return fallback;
  };

  return {
    token: pick('COZE_API_TOKEN'),
    workflowId: pick('COZE_WORKFLOW_ID'),
    apiBase: pick('COZE_API_BASE', 'https://api.coze.cn').replace(/\/+$/, ''),
    port: Number(pick('PORT', '8787')) || 8787,
    host: pick('HOST', '0.0.0.0'),
    allowTempLink: toBool(pick('ALLOW_TEMP_LINK', 'true'), true),
    timeoutMs: Number(pick('COZE_TIMEOUT_MS', '180000')) || 180000,
  };
}

/** 抹掉文本中可能出现的密钥，避免密钥进入日志或响应体。 */
export function redact(text, secrets = []) {
  let output = String(text ?? '');
  for (const secret of secrets) {
    if (secret && secret.length > 8) output = output.split(secret).join('***REDACTED***');
  }
  return output;
}

export function maskWorkflowId(id) {
  if (!id) return '';
  if (id.length <= 8) return `${id.slice(0, 2)}****`;
  return `${id.slice(0, 4)}****${id.slice(-4)}`;
}
