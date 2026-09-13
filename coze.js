import { redact } from './config.js';

/** 扣子开放平台调用封装：文件上传、工作流执行、临时链接发布。仅供服务端使用。 */
export class CozeClient {
  constructor(config) {
    this.config = config;
    this.secretList = [config.token];
  }

  get configured() {
    return Boolean(this.config.token && this.config.workflowId);
  }

  clean(text) {
    return redact(text, this.secretList);
  }

  /**
   * 上传文件到扣子，取得 file_id。需要访问密钥具备“文件上传”权限。
   */
  async uploadFile({ buffer, fileName, mimeType }) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), fileName);

    let response;
    try {
      response = await fetch(`${this.config.apiBase}/v1/files/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.token}` },
        body: form,
        signal: AbortSignal.timeout(Math.min(this.config.timeoutMs, 120000)),
      });
    } catch (error) {
      return { ok: false, kind: 'network', message: this.clean(error?.message || 'request failed') };
    }

    const text = this.clean(await response.text());
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* 忽略非 JSON 响应 */
    }

    if (json && json.code === 0 && json.data?.id) {
      return { ok: true, fileId: json.data.id, fileName: json.data.file_name || fileName };
    }

    const code = json?.code ?? response.status;
    const message = json?.msg || text.slice(0, 300) || `HTTP ${response.status}`;
    const permissionDenied = code === 4101 || /does not have permission/i.test(message);
    return { ok: false, code, kind: permissionDenied ? 'permission' : 'api', message };
  }

  /**
   * 通过一次性临时链接把合同内容交给工作流（当文件直传权限不可用时使用）。
   */
  async publishTempLink(text) {
    try {
      const response = await fetch('https://paste.rs/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: text,
        signal: AbortSignal.timeout(60000),
      });
      const body = (await response.text()).trim();
      if (response.ok && /^https?:\/\/\S+$/.test(body)) return { ok: true, url: body };
      return { ok: false, message: `临时链接服务返回异常（HTTP ${response.status}）` };
    } catch (error) {
      return { ok: false, message: this.clean(error?.message || '临时链接发布失败') };
    }
  }

  /**
   * 执行扣子工作流。工作流入参：wenjian（合同文件）、xuqiu（审查要求）。
   */
  async runWorkflow({ fileParam, requirement }) {
    const startedAt = Date.now();
    let response;
    try {
      response = await fetch(`${this.config.apiBase}/v1/workflow/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: this.config.workflowId,
          parameters: { wenjian: fileParam, xuqiu: requirement },
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return {
        ok: false,
        kind: timedOut ? 'timeout' : 'network',
        message: timedOut
          ? '扣子工作流调用超时，请稍后重试。'
          : `无法连接扣子接口：${this.clean(error?.message || 'unknown error')}`,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const text = this.clean(await response.text());
    const elapsedMs = Date.now() - startedAt;
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        kind: 'api',
        message: `扣子返回内容无法解析：${text.slice(0, 300)}`,
        elapsedMs,
      };
    }

    const executeId = json.execute_id || json.debug_url?.match(/execute_id=(\d+)/)?.[1] || '';
    const debugUrl = json.debug_url || '';

    if (json.code === 0 && json.data !== undefined && !json.interrupt_data) {
      return { ok: true, data: json.data, executeId, debugUrl, elapsedMs };
    }

    if (json.interrupt_data) {
      let detail = {};
      try {
        detail = JSON.parse(json.interrupt_data.data || '{}');
      } catch {
        /* 忽略解析失败 */
      }
      return {
        ok: false,
        kind: 'interrupt',
        message: detail.data || json.msg || '扣子工作流在等待授权。',
        pluginName: detail.plugin_name || '',
        authUrl: detail.auth_info || '',
        executeId,
        debugUrl,
        elapsedMs,
      };
    }

    const message = json.msg || `扣子返回错误码 ${json.code}`;
    const permissionDenied = json.code === 4101 || /does not have permission/i.test(message);
    return {
      ok: false,
      kind: permissionDenied ? 'permission' : 'api',
      code: json.code,
      message,
      executeId,
      debugUrl,
      elapsedMs,
    };
  }
}
