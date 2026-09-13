/**
 * 提交前/CI 用的密钥防泄漏扫描：
 *   1. 发现疑似扣子个人访问密钥（pat_ 开头）即失败；
 *   2. 发现 COZE_API_TOKEN 被填了真实值即失败；
 *   3. 确认 .env 没有被 Git 跟踪。
 *
 * 用法：node scripts/check-secrets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'work', 'dumps']);
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.doc', '.docx', '.zip']);

const PATTERNS = [
  { name: '扣子个人访问密钥', regex: /pat_[A-Za-z0-9_-]{20,}/ },
  { name: 'COZE_API_TOKEN 填入真实值', regex: /COZE_API_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/ },
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, files);
    } else if (!SKIP_EXT.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

const findings = [];
for (const file of walk(ROOT)) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/');
  // .env 本身就是密钥存放位置，不作为“泄露”报告，但必须被 Git 忽略
  if (relative === '.env') continue;
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const pattern of PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) findings.push(`${relative}: 疑似${pattern.name}（${match[0].slice(0, 6)}…）`);
  }
}

let envTracked = false;
try {
  const tracked = execFileSync('git', ['ls-files', '--error-unmatch', '.env'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
  envTracked = Boolean(tracked);
} catch {
  envTracked = false;
}

if (envTracked) findings.push('.env 已被 Git 跟踪：请执行 git rm --cached .env 并确认 .gitignore 生效');

if (findings.length) {
  console.error('发现潜在的密钥泄露风险：');
  findings.forEach((item) => console.error(`  - ${item}`));
  process.exit(1);
}

console.log('密钥扫描通过：未发现访问密钥被写入代码或文档，.env 未被 Git 跟踪。');
