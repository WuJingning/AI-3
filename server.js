import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, maskWorkflowId, PUBLIC_DIR, redact } from './lib/config.js';
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, extensionOf, extractText } from './lib/extract.js';
import { CozeClient } from './lib/coze.js';
import { attachDerivedQuotes, normalizeWorkflowResult } from './lib/normalize.js';
import { buildDemoResult } from './lib/demo.js';

const config = loadConfig();
const coze = new CozeClient(config);

// 调试开关：设置 CONTRACT_REVIEW_DUMP_DIR 后，把工作流原始返回写入该目录，便于排查输出结构。
const dumpDir = process.env.CONTRACT_REVIEW_DUMP_DIR || '';

function dumpRaw(payload) {
  if (!dumpDir) return;
  try {
    fs.mkdirSync(dumpDir, { recursive: true });
    const name = `raw-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(dumpDir, name), JSON.stringify(payload, null, 2), 'utf8');
    log(`已保存工作流原始返回：${name}`);
  } catch (error) {
    log('保存原始返回失败：', error?.message || String(error));
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

const MAX_BODY_BYTES = 24 * 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function log(...args) {
  const safe = args.map((arg) => (typeof arg === 'string' ? redact(arg, [config.token]) : arg));
  console.log('[合同审查工作台]', ...safe);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求数据格式错误'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function buildRequirement({ contractType, stance, focus, extra }) {
  const lines = [
    '请对本次提交的合同进行金融消费者权益保护与合规审查。',
    `【合同类型】${contractType || '未指定'}`,
    `【审查立场】${stance || '中立'}`,
    `【重点审查内容】${focus?.length ? focus.join('、') : '利率费用合规、风险提示披露、消费者权责条款、违约责任与违约金、个人信息授权、合同解除终止'}`,
  ];
  if (extra && String(extra).trim()) lines.push(`【补充审查要求】${String(extra).trim()}`);
  lines.push(
    '请严格按照以下结构输出，不要省略任何字段：',
    '1）审查意见清单：每条意见按以下字段分行输出——问题标题、风险等级（只能是“高”“中”“低”）、原文摘录（逐字引用合同原文，不得改写或省略）、问题分析、法条依据、修改建议；',
    '2）法律引用核验结果；',
    '3）企业信息核验结果；',
    '4）完整审查报告。'
  );
  return lines.join('\n');
}

function validateInput(body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const file = body.file && typeof body.file === 'object' ? body.file : null;
  if (!text && !file?.dataBase64) {
    return { ok: false, message: '请先上传合同文件或粘贴合同文本，再开始智能审查。' };
  }
  if (file?.dataBase64) {
    const ext = extensionOf(file.name || '');
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return { ok: false, message: '文件格式不支持，请上传 PDF、Word（doc/docx）、TXT 或 MD 文件。' };
    }
    if (Number(file.size) > MAX_FILE_BYTES) {
      return { ok: false, message: '文件大小超过 10MB，请压缩后重新上传。' };
    }
  }
  return { ok: true, text, file };
}

function demoPayload(body, reason, text) {
  const result = buildDemoResult({
    contractType: body.contractType,
    stance: body.stance,
    focus: body.focus,
    extra: body.extra,
    text,
    contractName: body.contractName || body.file?.name || '粘贴的合同文本',
  });
  return {
    status: 'ok',
    source: 'demo',
    result,
    meta: {
      transport: '本地演示数据',
      reason,
      elapsedMs: 0,
      demo: true,
    },
  };
}

async function handleReview(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, error.statusCode || 400, { status: 'error', message: error.message });
    return;
  }

  const validation = validateInput(body);
  if (!validation.ok) {
    sendJson(res, 400, { status: 'invalid', message: validation.message });
    return;
  }

  const { text, file } = validation;
  const contractName = file?.name || '粘贴的合同文本';
  const allowTempLink = body.allowTempLink === undefined ? config.allowTempLink : Boolean(body.allowTempLink);

  if (!coze.configured) {
    sendJson(res, 200, demoPayload(body, '未检测到扣子工作流配置（缺少 COZE_WORKFLOW_ID 或访问密钥），已使用本地演示结果。', text));
    return;
  }

  if (body.mode === 'demo' || body.mode === 'force-demo') {
    sendJson(res, 200, { ...demoPayload(body, '用户选择使用演示结果。', text), source: 'demo' });
    return;
  }

  let fileBuffer = null;
  if (file?.dataBase64) {
    try {
      fileBuffer = Buffer.from(String(file.dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
    } catch {
      sendJson(res, 400, { status: 'invalid', message: '文件内容解析失败，请重新上传。' });
      return;
    }
    if (fileBuffer.length > MAX_FILE_BYTES) {
      sendJson(res, 400, { status: 'invalid', message: '文件大小超过 10MB，请压缩后重新上传。' });
      return;
    }
  }

  // 本地提取合同文本用于左侧原文展示（PDF/Word 由扣子侧解析）
  let contractText = text;
  if (!contractText && fileBuffer) {
    const extracted = extractText(file.name, fileBuffer);
    if (extracted.ok) contractText = extracted.text;
  }

  const warnings = [];
  let transport = '';
  let fileParam = null;

  if (fileBuffer) {
    const upload = await coze.uploadFile({
      buffer: fileBuffer,
      fileName: file.name,
      mimeType: file.type,
    });
    if (upload.ok) {
      fileParam = { file_id: upload.fileId };
      transport = '扣子文件直传';
    } else if (upload.kind === 'permission') {
      warnings.push(
        '当前访问密钥没有“文件上传”权限，无法把文件直传给扣子工作流。如需长期使用文件直传，请在扣子个人访问令牌中勾选文件上传权限。'
      );
    } else {
      warnings.push(`文件上传扣子失败：${upload.message}`);
    }
  }

  let tempLinkText = '';
  if (!fileParam) {
    if (contractText) {
      tempLinkText = contractText;
    } else if (text) {
      tempLinkText = text;
    }
    if (!tempLinkText && fileBuffer) {
      sendJson(res, 200, {
        status: 'error',
        source: 'coze',
        message:
          '无法把该文件提交给扣子工作流：访问密钥缺少“文件上传”权限，且本地无法解析 PDF / DOC 内容以便改用文本方式提交。',
        hint: '请在扣子“个人访问令牌”中勾选文件上传权限后重试；或先把合同内容粘贴到文本框中提交。',
        meta: { warnings, demoAvailable: true },
      });
      return;
    }

    if (allowTempLink) {
      const published = await coze.publishTempLink(tempLinkText);
      if (published.ok) {
        fileParam = published.url;
        transport = '一次性临时链接提交';
        warnings.push('本次合同内容通过一次性临时链接提交给扣子工作流，链接仅用于本次分析。');
      } else {
        warnings.push(`临时链接提交失败：${published.message}`);
      }
    } else {
      warnings.push('已关闭“临时链接提交”，且访问密钥缺少文件上传权限，无法把合同内容送达工作流。');
    }
  }

  if (!fileParam) {
    sendJson(res, 200, {
      status: 'error',
      source: 'coze',
      message: '未能把合同内容提交给扣子工作流。',
      hint: '请在扣子个人访问令牌中开启“文件上传”权限，或在提交区域允许使用一次性临时链接后重试。',
      meta: { warnings, demoAvailable: true },
    });
    return;
  }

  const requirement = buildRequirement(body);
  log(`调用工作流 workflow=${maskWorkflowId(config.workflowId)} transport=${transport}`);
  const run = await coze.runWorkflow({ fileParam, requirement });

  if (run.ok) {
    dumpRaw({ data: run.data });
    const result = normalizeWorkflowResult(run.data);
    attachDerivedQuotes(result.opinions, contractText);
    log(`工作流返回成功 elapsed=${run.elapsedMs}ms 解析意见=${result.opinions.length}`);
    sendJson(res, 200, {
      status: 'ok',
      source: 'coze',
      result: {
        ...result,
        demo: false,
        contract: {
          name: contractName,
          type: body.contractType || '未指定',
          stance: body.stance || '中立',
          focus: body.focus || [],
          text: contractText,
          charCount: contractText.length,
          hasText: contractText.length > 0,
        },
      },
      meta: {
        transport,
        warnings,
        elapsedMs: run.elapsedMs,
        executeId: run.executeId,
        debugUrl: run.debugUrl,
        demo: false,
      },
    });
    return;
  }

  if (run.kind === 'interrupt') {
    log(`工作流中断（等待授权）plugin=${run.pluginName || '未知'} elapsed=${run.elapsedMs}ms`);
    sendJson(res, 200, {
      status: 'needs_auth',
      source: 'coze',
      message: run.pluginName
        ? `扣子工作流在“${run.pluginName}”环节暂停，该环节需要先完成授权才能返回审查结果。`
        : '扣子工作流暂停，需要先完成插件授权后才能返回审查结果。',
      detail: run.message,
      authUrl: run.authUrl,
      debugUrl: run.debugUrl,
      hint: '完成授权后重新提交即可获取完整审查结果；也可以先使用演示结果体验页面效果。',
      meta: { transport, warnings, elapsedMs: run.elapsedMs, demoAvailable: true },
    });
    return;
  }

  log(`工作流调用失败 kind=${run.kind} message=${run.message}`);
  sendJson(res, 200, {
    status: 'error',
    source: 'coze',
    message: run.message || '扣子工作流调用失败。',
    hint:
      run.kind === 'timeout'
        ? '工作流执行时间较长，请稍后重试。'
        : '请检查工作流 ID、访问密钥权限与网络连通性后重试。',
    debugUrl: run.debugUrl,
    meta: { transport, warnings, elapsedMs: run.elapsedMs, demoAvailable: true },
  });
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
  if (relative.includes('..') || relative.startsWith('.')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('未找到该页面');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/healthz' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, configured: coze.configured });
      return;
    }
    if (pathname === '/api/status' && req.method === 'GET') {
      sendJson(res, 200, {
        configured: coze.configured,
        workflowId: maskWorkflowId(config.workflowId),
        apiBase: config.apiBase,
        allowTempLink: config.allowTempLink,
        tokenStored: config.token ? 'server-side' : 'missing',
      });
      return;
    }
    if (pathname === '/api/review' && req.method === 'POST') {
      await handleReview(req, res);
      return;
    }
    if (pathname === '/api/demo' && req.method === 'POST') {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        body = {};
      }
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      sendJson(res, 200, demoPayload(body, '用户选择使用演示结果。', text));
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { status: 'error', message: '接口不存在' });
      return;
    }
    if (req.method === 'GET') {
      serveStatic(req, res, pathname);
      return;
    }
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
  } catch (error) {
    log('服务端异常：', redact(error?.stack || error?.message || String(error), [config.token]));
    if (!res.headersSent) sendJson(res, 500, { status: 'error', message: '服务端处理异常，请稍后重试。' });
    else res.end();
  }
});

server.listen(config.port, config.host, () => {
  log(`服务已启动：http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  log(
    coze.configured
      ? `扣子工作流状态：已配置（工作流 ${maskWorkflowId(config.workflowId)}）`
      : '扣子工作流状态：未配置，将使用本地演示结果'
  );
  log('访问密钥仅在服务端使用，不会写入页面或浏览器代码。');
});

// 容器/服务停止时优雅退出，避免请求被硬中断
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`收到 ${signal}，正在停止服务…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
