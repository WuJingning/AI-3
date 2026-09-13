(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const ACCEPTED = ['pdf', 'doc', 'docx', 'txt', 'md', 'markdown'];
  const HISTORY_KEY = 'contract-review-workbench-history-v1';
  const HISTORY_LIMIT = 8;

  const state = {
    file: null,
    fileText: '',
    running: false,
    result: null,
    source: '',
    meta: {},
    contractMeta: {},
    filter: '全部',
    activeOpinionId: '',
    status: { configured: false },
    timers: [],
    lastRequest: null,
  };

  /* ---------------- 通用工具 ---------------- */

  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      node.hidden = true;
    }, 2600);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatTime(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}:${pad(date.getSeconds())}`;
  }

  function levelClass(level) {
    if (level === '高') return 'high';
    if (level === '中') return 'medium';
    if (level === '低') return 'low';
    return 'unknown';
  }

  function levelLabel(level) {
    return level ? `${level}风险` : '未分级';
  }

  /** 平滑滚动到指定区域；在不支持 scrollIntoView 的环境中静默跳过。 */
  function scrollToNode(node, block) {
    if (!node || typeof node.scrollIntoView !== 'function') return;
    node.scrollIntoView({ behavior: 'smooth', block: block || 'start' });
  }

  async function copyText(text, successMessage) {
    const value = String(text ?? '');
    if (!value.trim()) {
      toast('没有可复制的内容');
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document.execCommand === 'function') {
        const helper = document.createElement('textarea');
        helper.value = value;
        helper.setAttribute('readonly', 'readonly');
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        document.body.removeChild(helper);
      } else {
        throw new Error('当前环境不支持自动复制');
      }
      toast(successMessage || '已复制到剪贴板');
    } catch (error) {
      toast('复制失败，请手动选择文本复制');
    }
  }

  /* ---------------- 连接状态 ---------------- */

  async function loadStatus() {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      state.status = data;
      const chip = $('cozeStatus');
      if (data.configured) {
        chip.dataset.state = 'ok';
        $('cozeStatusText').textContent = '扣子工作流已连接';
        $('statusDetail').textContent = `工作流 ${data.workflowId || ''} · 访问密钥仅保存在服务端`;
      } else {
        chip.dataset.state = 'demo';
        $('cozeStatusText').textContent = '扣子工作流未连接 · 演示模式';
        $('statusDetail').textContent = '请在服务端 .env 中配置工作流 ID 与访问密钥';
      }
    } catch (error) {
      // 没有服务端（例如页面被部署到 GitHub Pages 等纯静态托管）时进入离线演示模式，
      // 由浏览器本地演示数据保证界面与流程可以完整展示。
      state.offline = true;
      const chip = $('cozeStatus');
      chip.dataset.state = 'demo';
      $('cozeStatusText').textContent = '离线演示模式 · 未连接服务端';
      $('statusDetail').textContent = '当前为静态页面部署，可完整演示界面；真实审查需启动服务端';
    }
  }

  function setStatus(stateName, text, detail) {
    const chip = $('cozeStatus');
    chip.dataset.state = stateName;
    $('cozeStatusText').textContent = text;
    if (detail) $('statusDetail').textContent = detail;
  }

  /* ---------------- 表单交互 ---------------- */

  function getStance() {
    const active = document.querySelector('.segmented__item.is-active');
    return active ? active.dataset.stance : '中立';
  }

  function getFocus() {
    return Array.from(document.querySelectorAll('#focusGroup input:checked')).map((input) => input.value);
  }

  function collectInputs() {
    const text = $('contractText').value.trim();
    return {
      contractType: $('contractType').value,
      stance: getStance(),
      focus: getFocus(),
      extra: $('extra').value.trim(),
      text,
      contractName: state.file ? state.file.name : text ? '粘贴的合同文本' : '未命名合同',
      allowTempLink: $('allowTempLink').checked,
    };
  }

  function showFormError(message) {
    const node = $('formError');
    node.textContent = message;
    node.hidden = false;
  }

  function hideFormError() {
    $('formError').hidden = true;
  }

  function updateCharCount() {
    const length = $('contractText').value.trim().length;
    $('charCount').textContent = length ? `${length} 字` : '0 字';
  }

  function setFile(file) {
    if (!file) return;
    hideFormError();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ACCEPTED.includes(ext)) {
      showFormError('文件格式不支持，请上传 PDF、Word（doc/docx）、TXT 或 MD 文件。');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showFormError('文件大小超过 10MB，请压缩后重新上传。');
      return;
    }
    state.file = file;
    state.fileText = '';
    $('fileName').textContent = file.name;
    $('fileSize').textContent = formatBytes(file.size);
    $('fileChip').hidden = false;
    $('dropzone').classList.add('is-filled');

    if (['txt', 'md', 'markdown'].includes(ext)) {
      const reader = new FileReader();
      reader.onload = () => {
        state.fileText = String(reader.result || '').trim();
        if (state.fileText && !$('contractText').value.trim()) {
          $('contractText').value = state.fileText;
          updateCharCount();
          toast('已读取文件文本，可用于即时预览与演示');
        }
      };
      reader.readAsText(file, 'utf-8');
    }
  }

  function clearFile() {
    state.file = null;
    state.fileText = '';
    $('fileInput').value = '';
    $('fileChip').hidden = true;
    $('dropzone').classList.remove('is-filled');
  }

  function resetForm() {
    clearFile();
    $('contractText').value = '';
    $('extra').value = '';
    document.querySelectorAll('#focusGroup input').forEach((input) => {
      input.checked = false;
    });
    $('contractType').selectedIndex = 0;
    document.querySelectorAll('.segmented__item').forEach((item) => {
      const isNeutral = item.dataset.stance === '中立';
      item.classList.toggle('is-active', isNeutral);
      item.setAttribute('aria-checked', String(isNeutral));
    });
    hideFormError();
    updateCharCount();
    hideResults();
    resetSteps();
    toast('已重置当前内容');
  }

  /* ---------------- 步骤与进度 ---------------- */

  const STEP_LABELS = {
    idle: '待执行',
    active: '进行中…',
    done: '已完成',
    warn: '需要授权',
    error: '未完成',
  };

  function setStep(index, stepState) {
    const node = document.querySelector(`#steps .step[data-step="${index}"]`);
    if (!node) return;
    node.dataset.state = stepState;
    const label = node.querySelector('.step__state');
    if (label) label.textContent = STEP_LABELS[stepState] || STEP_LABELS.idle;
  }

  function resetSteps() {
    [1, 2, 3, 4].forEach((index) => setStep(index, 'idle'));
  }

  function clearTimers() {
    state.timers.forEach((timer) => clearTimeout(timer));
    state.timers = [];
  }

  function renderProgressSteps(activeIndex) {
    const list = $('progressSteps');
    list.innerHTML = '';
    const names = ['提取合同内容', '查询企业信息', '审查合同条款', '生成审查报告'];
    names.forEach((name, offset) => {
      const index = offset + 1;
      const item = document.createElement('li');
      item.dataset.state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'idle';
      item.textContent = `${index < activeIndex ? '✓' : index === activeIndex ? '●' : '○'} ${name}`;
      list.appendChild(item);
    });
  }

  function startProgress() {
    clearTimers();
    $('progressCard').hidden = false;
    $('progressSpinner').hidden = false;
    $('progressIcon').hidden = true;
    $('progressCard').classList.remove('is-done', 'is-warn', 'is-error');
    $('progressTitle').textContent = '正在进行智能审查';
    $('progressMessage').textContent = '正在提取文本并逐项分析合同条款，请稍候…';
    resetSteps();
    setStep(1, 'active');
    renderProgressSteps(1);

    const timeline = [
      { at: 1600, step: 2, message: '正在查询合同相对方的企业信息与涉诉、处罚记录…' },
      { at: 4200, step: 3, message: '正在逐条审查合同条款，识别消费者权益保护相关风险…' },
      { at: 9000, step: 4, message: '正在核验法律引用并整理修改建议，生成审查报告…' },
    ];
    timeline.forEach((entry) => {
      state.timers.push(
        setTimeout(() => {
          if (!state.running) return;
          setStep(entry.step - 1, 'done');
          setStep(entry.step, 'active');
          renderProgressSteps(entry.step);
          $('progressMessage').textContent = entry.message;
        }, entry.at)
      );
    });
  }

  function finishProgress(ok, needsAuth) {
    clearTimers();
    // 结束状态：停掉转圈动画，换成静态状态图标（避免看起来还在审查）
    const spinner = $('progressSpinner');
    const icon = $('progressIcon');
    const card = $('progressCard');
    spinner.hidden = true;
    icon.hidden = false;
    card.classList.remove('is-done', 'is-warn', 'is-error');
    icon.classList.remove('progress-icon--warn', 'progress-icon--error');
    if (ok) {
      icon.textContent = '✓';
      card.classList.add('is-done');
    } else if (needsAuth) {
      icon.textContent = '!';
      icon.classList.add('progress-icon--warn');
      card.classList.add('is-warn');
    } else {
      icon.textContent = '×';
      icon.classList.add('progress-icon--error');
      card.classList.add('is-error');
    }
    [1, 2, 3].forEach((index) => setStep(index, ok || needsAuth ? 'done' : 'error'));
    if (ok) {
      setStep(4, 'done');
      $('progressTitle').textContent = '审查完成';
      $('progressMessage').textContent = '审查结果已生成，可在下方查看审查意见与整改建议。';
    } else if (needsAuth) {
      setStep(4, 'warn');
      $('progressTitle').textContent = '审查在生成报告环节暂停';
      $('progressMessage').textContent = '扣子工作流的飞书报告环节需要先完成授权，授权后重新提交即可获取完整结果。';
    } else {
      setStep(4, 'error');
      $('progressTitle').textContent = '审查未完成';
      $('progressMessage').textContent = '未能从扣子工作流获取审查结果，请查看下方提示后重试。';
    }
  }

  function hideResults() {
    $('results').hidden = true;
    state.result = null;
    state.activeOpinionId = '';
  }

  /* ---------------- 提交审查 ---------------- */

  function setRunning(running) {
    state.running = running;
    $('submitBtn').disabled = running;
    $('submitBtn').textContent = running ? '正在审查中…' : '开始智能审查';
    $('resetBtn').disabled = running;
    $('submitBtn').setAttribute('aria-busy', String(running));
  }

  async function requestReview(forceDemo) {
    if (state.running) return;
    const inputs = collectInputs();
    if (!forceDemo && !state.file && !inputs.text) {
      showFormError('请先上传合同文件或粘贴合同文本，再开始智能审查。');
      scrollToNode($('formError'), 'center');
      return;
    }
    hideFormError();
    hideResults();
    setRunning(true);
    startProgress();
    state.lastRequest = inputs;

    const payload = {
      contractType: inputs.contractType,
      stance: inputs.stance,
      focus: inputs.focus,
      extra: inputs.extra,
      text: state.file && !inputs.text ? '' : inputs.text,
      contractName: inputs.contractName,
      allowTempLink: inputs.allowTempLink,
      mode: forceDemo ? 'demo' : 'auto',
    };

    if (state.file && !forceDemo) {
      const base64 = await readFileAsBase64(state.file);
      payload.file = {
        name: state.file.name,
        size: state.file.size,
        type: state.file.type,
        dataBase64: base64,
      };
    }

    // 离线（没有服务端）时直接用浏览器本地演示数据，保证静态托管下也能完整演示
    if (state.offline) {
      renderLocalDemo(inputs, '');
      setRunning(false);
      return;
    }

    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      handleResponse(data, inputs);
    } catch (error) {
      // 服务端中途不可用时，同样回退到本地演示数据，并明确提示
      state.offline = true;
      renderLocalDemo(inputs, '服务端暂时不可用，已自动切换为浏览器本地演示结果。');
    } finally {
      setRunning(false);
    }
  }

  /** 用浏览器内置的演示数据渲染结果（仅在无法连接服务端时使用，页面会标注“演示结果”）。 */
  function renderLocalDemo(inputs, notice) {
    if (!window.ContractReviewDemo || typeof window.ContractReviewDemo.build !== 'function') {
      finishProgress(false, false);
      renderError({
        title: '无法连接本地服务',
        message: '提交失败：未检测到服务端，且当前页面缺少本地演示数据文件（demo-data.js）。',
        hint: '请通过 node server.js 启动服务端，或确认 demo-data.js 已随页面一起部署。',
        demoAvailable: false,
      });
      return;
    }
    const demo = window.ContractReviewDemo.build({
      contractType: inputs.contractType,
      stance: inputs.stance,
      focus: inputs.focus,
      extra: inputs.extra,
      text: state.fileText && !inputs.text ? state.fileText : inputs.text,
      contractName: inputs.contractName,
    });
    if (notice) demo.meta.warnings = [notice, ...(demo.meta.warnings || [])];
    finishProgress(true, false);
    renderResult(demo.result, demo.source, demo.meta, inputs);
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function handleResponse(data, inputs) {
    if (data.status === 'ok' && data.result) {
      finishProgress(true, false);
      renderResult(data.result, data.source, data.meta || {}, inputs);
      return;
    }
    if (data.status === 'needs_auth') {
      finishProgress(false, true);
      renderError({
        title: '扣子工作流需要完成授权',
        message: data.message || '工作流暂停，等待插件授权。',
        hint: data.hint || '',
        authUrl: data.authUrl,
        debugUrl: data.debugUrl,
        demoAvailable: true,
      });
      setStatus('warn', '扣子工作流已连接 · 等待授权', '工作流在飞书报告环节需要先完成授权');
      return;
    }
    finishProgress(false, false);
    renderError({
      title: data.status === 'invalid' ? '提交内容有误' : '未能获取审查结果',
      message: data.message || '扣子工作流调用未成功。',
      hint: data.hint || '',
      debugUrl: data.debugUrl,
      demoAvailable: data.status !== 'invalid',
    });
    if (data.status !== 'invalid') setStatus('error', '扣子工作流调用异常', '可在提示信息中查看原因并重试');
  }

  /* ---------------- 结果渲染 ---------------- */

  function renderError({ title, message, hint, authUrl, debugUrl, demoAvailable }) {
    const banner = $('errorBanner');
    $('errorTitle').textContent = title;
    $('errorMessage').textContent = message;
    $('errorHint').textContent = hint || '';
    $('errorHint').hidden = !hint;
    const actions = $('errorActions');
    actions.innerHTML = '';

    if (authUrl) {
      const link = document.createElement('a');
      link.className = 'btn btn--small btn--primary';
      link.href = authUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '打开飞书授权页面';
      actions.appendChild(link);
    }
    if (debugUrl) {
      const link = document.createElement('a');
      link.className = 'btn btn--small btn--ghost';
      link.href = debugUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '查看扣子工作流执行详情';
      actions.appendChild(link);
    }
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn--small btn--ghost';
    retry.textContent = '重新尝试';
    retry.addEventListener('click', () => requestReview(false));
    actions.appendChild(retry);

    if (demoAvailable) {
      const demo = document.createElement('button');
      demo.type = 'button';
      demo.className = 'btn btn--small btn--ghost';
      demo.textContent = '使用演示结果';
      demo.addEventListener('click', () => requestReview(true));
      actions.appendChild(demo);
    }

    banner.hidden = false;
    $('results').hidden = false;
    $('demoBanner').hidden = true;
    $('warnBanner').hidden = true;
    $('conclusion').hidden = true;
    $('metaGrid').hidden = true;
    document.querySelectorAll('.verify-card, .workspace, .raw-card, .result-actions, .disclaimer').forEach((node) => {
      node.hidden = true;
    });
    scrollToNode($('results'));
  }

  function renderResult(result, source, meta, inputs) {
    state.result = result;
    state.source = source;
    state.meta = meta || {};
    const contract = result.contract || {
      name: inputs.contractName,
      type: inputs.contractType,
      stance: inputs.stance,
      focus: inputs.focus,
      text: inputs.text,
      charCount: (inputs.text || '').length,
      hasText: Boolean(inputs.text),
    };
    state.contractMeta = contract;

    $('errorBanner').hidden = true;
    $('conclusion').hidden = false;
    $('metaGrid').hidden = false;
    document.querySelectorAll('.verify-card, .workspace, .result-actions, .disclaimer').forEach((node) => {
      node.hidden = false;
    });

    const isDemo = source === 'demo' || result.demo;
    const demoBanner = $('demoBanner');
    demoBanner.hidden = !isDemo;
    if (isDemo) {
      $('demoBannerText').textContent =
        result.demoNotice || '未获取到扣子工作流的真实返回，本页使用本地示例数据展示完整交互。';
    }

    const warnings = (meta && meta.warnings) || [];
    const warnBanner = $('warnBanner');
    if (warnings.length) {
      warnBanner.textContent = warnings.join('\n');
      warnBanner.hidden = false;
    } else {
      warnBanner.hidden = true;
    }

    renderConclusion(result);
    renderMeta(result, source, meta, contract);
    renderVerify(result);
    renderContract(result, contract);
    state.filter = '全部';
    renderOpinions(result);
    renderRaw(result, meta);
    renderReportLink(result, source);

    $('results').hidden = false;
    scrollToNode($('results'));

    if (source === 'coze') {
      setStatus('ok', '扣子工作流已连接', `工作流 ${state.status.workflowId || ''} · 最近一次调用成功`);
    } else if (!state.status.configured) {
      setStatus('demo', '扣子工作流未连接 · 演示模式', '请在服务端 .env 中配置工作流 ID 与访问密钥');
    } else {
      setStatus('warn', '扣子工作流已连接 · 本次为演示结果', '可通过重新尝试再次调用真实工作流');
    }

    saveHistory(result, source, contract);
  }

  function renderConclusion(result) {
    const counts = result.counts || { high: 0, medium: 0, low: 0, unknown: 0, total: (result.opinions || []).length };
    const hasRawOnly = !counts.total && Boolean(result.rawOutput || result.rawData);
    $('countHigh').textContent = counts.high || 0;
    $('countMedium').textContent = counts.medium || 0;
    $('countLow').textContent = counts.low || 0;
    $('countUnknown').textContent = counts.unknown || 0;
    $('countUnknownWrap').hidden = !counts.unknown;
    $('counts').hidden = false;
    $('conclusionTitle').textContent = counts.total
      ? `共发现 ${counts.total} 条审查意见`
      : hasRawOnly
        ? '工作流已返回内容，但未识别到结构化意见'
        : '未发现可明确判断的问题';
    $('conclusionText').textContent = counts.total
      ? result.conclusion || ''
      : hasRawOnly
        ? '扣子工作流已返回内容，但未包含可识别的审查意见字段，请在下方“查看工作流原始输出”中核对返回结构。'
        : result.conclusion || '未发现可明确判断的问题，仍需人工复核。';
    $('conclusionBadge').textContent = result.demo ? '演示结果' : hasRawOnly ? '需核对输出' : '审查完成';
  }

  function renderMeta(result, source, meta, contract) {
    const grid = $('metaGrid');
    grid.innerHTML = '';
    const elapsed = meta.elapsedMs ? `${(meta.elapsedMs / 1000).toFixed(1)} 秒` : '—';
    const items = [
      { label: '合同名称', value: contract.name || '未命名合同' },
      { label: '合同类型', value: contract.type || '未指定' },
      { label: '审查立场', value: contract.stance || '中立' },
      { label: '审查时间', value: formatTime(new Date()) },
      { label: '数据来源', value: source === 'coze' ? '扣子工作流' : '演示结果（未调用真实工作流）' },
      { label: '提交方式', value: meta.transport || '—' },
      { label: '工作流耗时', value: elapsed },
    ];
    if (meta.executeId) items.push({ label: '执行 ID', value: meta.executeId });
    if (contract.charCount) items.push({ label: '合同字数', value: `${contract.charCount} 字` });

    items.forEach((item) => {
      const wrap = document.createElement('dl');
      wrap.className = 'meta-item';
      const dt = document.createElement('dt');
      dt.textContent = item.label;
      const dd = document.createElement('dd');
      dd.textContent = item.value;
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      grid.appendChild(wrap);
    });
  }

  function renderVerify(result) {
    const legal = result.legalCheck || {};
    $('legalStatus').textContent = legal.status || (result.demo ? '演示数据' : '已完成');
    $('legalSummary').textContent = legal.summary || '未返回法律引用核验摘要。';
    const legalItems = $('legalItems');
    legalItems.innerHTML = '';
    (legal.items || []).forEach((item) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = item.label;
      const value = document.createElement('span');
      value.className = `kv-value ${String(item.value).includes('需复核') || String(item.value).includes('无效') ? 'kv-value--warn' : 'kv-value--ok'}`;
      value.textContent = item.value || '—';
      li.appendChild(label);
      li.appendChild(value);
      legalItems.appendChild(li);
    });
    if (!(legal.items || []).length) {
      const li = document.createElement('li');
      li.textContent = '未返回结构化核验明细。';
      legalItems.appendChild(li);
    }

    const enterprise = result.enterpriseCheck || {};
    $('enterpriseStatus').textContent = enterprise.status || (result.demo ? '演示数据' : '已完成');
    $('enterpriseSummary').textContent =
      [enterprise.name, enterprise.note].filter(Boolean).join(' · ') || '未返回企业信息核验摘要。';
    const enterpriseItems = $('enterpriseItems');
    enterpriseItems.innerHTML = '';
    (enterprise.items || []).forEach((item) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = item.label;
      const value = document.createElement('span');
      value.className = 'kv-value';
      value.textContent = item.value || '—';
      li.appendChild(label);
      li.appendChild(value);
      enterpriseItems.appendChild(li);
    });
    if (!(enterprise.items || []).length) {
      const li = document.createElement('li');
      li.textContent = '未返回企业信息明细。';
      enterpriseItems.appendChild(li);
    }
  }

  function buildNormalizedText(text) {
    const mapping = [];
    let normalized = '';
    let lastWasSpace = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (/\s/.test(char)) {
        if (lastWasSpace) continue;
        lastWasSpace = true;
        normalized += ' ';
        mapping.push(index);
      } else {
        lastWasSpace = false;
        normalized += char;
        mapping.push(index);
      }
    }
    mapping.push(text.length);
    return { normalized, mapping };
  }

  function findRange(text, quote) {
    const cleaned = String(quote || '').replace(/[。；;、\s]+$/g, '').trim();
    if (cleaned.length < 6) return null;
    const direct = text.indexOf(cleaned);
    if (direct !== -1) return { start: direct, end: direct + cleaned.length };

    const target = buildNormalizedText(cleaned);
    const source = buildNormalizedText(text);
    const position = source.normalized.indexOf(target.normalized);
    if (position === -1) {
      const fragment = cleaned.slice(0, 24);
      if (fragment.length >= 10) {
        const shortTarget = buildNormalizedText(fragment);
        const shortPosition = source.normalized.indexOf(shortTarget.normalized);
        if (shortPosition !== -1) {
          const start = source.mapping[shortPosition];
          const end = source.mapping[shortPosition + shortTarget.normalized.length] ?? text.length;
          return { start, end };
        }
      }
      return null;
    }
    const start = source.mapping[position];
    const end = source.mapping[position + target.normalized.length] ?? text.length;
    return { start, end };
  }

  function buildRanges(text, opinions) {
    const ranges = [];
    opinions.forEach((opinion) => {
      const range = findRange(text, opinion.quote);
      if (range) ranges.push({ ...range, id: opinion.id, level: opinion.level });
    });
    ranges.sort((a, b) => a.start - b.start);
    const result = [];
    let cursor = -1;
    ranges.forEach((range) => {
      if (range.start >= cursor) {
        result.push(range);
        cursor = range.end;
      }
    });
    return result;
  }

  function renderContract(result, contract) {
    const body = $('contractBody');
    body.innerHTML = '';
    const text = (contract.text || '').trim();
    const linked = (result.opinions || []).filter((opinion) => opinion.quote).length;
    $('contractMeta').textContent = text
      ? `${contract.name || ''} · ${text.length} 字 · 已关联 ${linked} 条意见原文`
      : '未获取到可展示的合同原文';

    if (!text) {
      const placeholder = document.createElement('p');
      placeholder.className = 'placeholder';
      placeholder.textContent =
        '本次未在本地提取到可展示的合同原文（PDF / Word 文件由扣子工作流侧解析）。审查意见中的“原文摘录”仍可正常查看。若需要左侧同步高亮合同原文，可同时把合同文本粘贴到提交区域。';
      body.appendChild(placeholder);
      return;
    }

    const ranges = buildRanges(text, result.opinions || []);
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    ranges.forEach((range) => {
      if (range.start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
      const mark = document.createElement('mark');
      mark.className = `hl hl--${levelClass(range.level)}`;
      mark.dataset.opinionId = range.id;
      mark.textContent = text.slice(range.start, range.end);
      mark.title = `点击定位到该意见（${levelLabel(range.level)}）`;
      mark.addEventListener('click', () => focusOpinion(range.id, false));
      fragment.appendChild(mark);
      cursor = range.end;
    });
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    body.appendChild(fragment);
  }

  function renderOpinions(result) {
    const list = $('opinionList');
    list.innerHTML = '';
    const opinions = result.opinions || [];
    const counts = result.counts || { high: 0, medium: 0, low: 0, unknown: 0, total: opinions.length };
    $('filterAll').textContent = counts.total || 0;
    $('filterHigh').textContent = counts.high || 0;
    $('filterMedium').textContent = counts.medium || 0;
    $('filterLow').textContent = counts.low || 0;
    $('filterUnknown').textContent = counts.unknown || 0;
    $('filterUnknownBtn').hidden = !counts.unknown;
    if (!counts.unknown && state.filter === '未分级') state.filter = '全部';
    $('opinionCount').textContent = `（${opinions.length} 条）`;

    document.querySelectorAll('#levelFilters .filter').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.level === state.filter);
    });

    const filtered =
      state.filter === '全部'
        ? opinions
        : opinions.filter((opinion) => (state.filter === '未分级' ? !opinion.level : opinion.level === state.filter));

    if (!opinions.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        result.rawOutput || result.rawData
          ? '工作流已返回内容，但未包含可识别的结构化意见字段，请查看下方“工作流原始输出”，或调整工作流输出结构。'
          : '未发现可明确判断的问题，仍需人工复核。';
      list.appendChild(empty);
      return;
    }
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = `当前没有${state.filter}风险等级的审查意见。`;
      list.appendChild(empty);
      return;
    }

    filtered.forEach((opinion) => {
      list.appendChild(buildOpinionCard(opinion));
    });
  }

  function buildOpinionCard(opinion) {
    const card = document.createElement('article');
    card.className = 'opinion';
    card.dataset.level = opinion.level || '未分级';
    card.dataset.id = opinion.id;
    card.tabIndex = 0;
    if (state.activeOpinionId === opinion.id) card.classList.add('is-active');

    const head = document.createElement('div');
    head.className = 'opinion__head';
    const tag = document.createElement('span');
    tag.className = `tag tag--${levelClass(opinion.level)}`;
    tag.textContent = levelLabel(opinion.level);
    const title = document.createElement('h4');
    title.className = 'opinion__title';
    title.textContent = opinion.title;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'opinion__copy';
    copy.textContent = '复制修改建议';
    copy.addEventListener('click', (event) => {
      event.stopPropagation();
      copyText(buildSuggestionText(opinion), '已复制该条修改建议');
    });
    head.appendChild(tag);
    head.appendChild(title);
    head.appendChild(copy);
    card.appendChild(head);

    card.appendChild(
      buildBlock(
        opinion.quoteSource === 'derived' ? '原文摘录（本地匹配，工作流未返回摘录）' : '原文摘录',
        opinion.quote || '（本次工作流未返回该条意见的原文摘录，且未能在合同原文中匹配到对应条款）',
        'quote'
      )
    );
    card.appendChild(buildBlock('问题分析', opinion.analysis || '工作流未返回该条问题的分析内容。', 'text'));
    if (opinion.legalBasis && opinion.legalBasis.length) {
      card.appendChild(buildBlock('法条依据', opinion.legalBasis, 'law'));
    }
    card.appendChild(buildBlock('整改建议', opinion.suggestion || '工作流未返回该条意见的修改建议。', 'suggest'));

    card.addEventListener('click', () => focusOpinion(opinion.id, true));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') focusOpinion(opinion.id, true);
    });
    return card;
  }

  function buildBlock(label, content, kind) {
    const wrap = document.createElement('div');
    wrap.className = 'opinion__block';
    const caption = document.createElement('span');
    caption.className = 'opinion__label';
    caption.textContent = label;
    wrap.appendChild(caption);

    if (kind === 'law' && Array.isArray(content)) {
      const ul = document.createElement('ul');
      ul.className = 'law-list';
      content.forEach((law) => {
        const li = document.createElement('li');
        li.textContent = law;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    } else if (kind === 'quote') {
      const quote = document.createElement('blockquote');
      quote.className = 'quote';
      quote.textContent = content;
      wrap.appendChild(quote);
    } else if (kind === 'suggest') {
      const box = document.createElement('div');
      box.className = 'suggest-box';
      box.textContent = content;
      wrap.appendChild(box);
    } else {
      const p = document.createElement('p');
      p.className = 'opinion__text';
      p.textContent = content;
      wrap.appendChild(p);
    }
    return wrap;
  }

  function focusOpinion(id, fromList) {
    if (!id) return;
    state.activeOpinionId = id;
    document.querySelectorAll('.opinion').forEach((card) => {
      card.classList.toggle('is-active', card.dataset.id === id);
    });
    document.querySelectorAll('mark.hl').forEach((mark) => {
      mark.classList.toggle('is-active', mark.dataset.opinionId === id);
    });
    const target = fromList
      ? document.querySelector(`mark.hl[data-opinion-id="${id}"]`)
      : document.querySelector(`.opinion[data-id="${id}"]`);
    scrollToNode(target, 'center');
  }

  function renderRaw(result, meta) {
    const card = $('rawCard');
    const payload = result.rawData ?? result.rawOutput;
    if (payload === undefined || payload === null || payload === '') {
      card.hidden = true;
      return;
    }
    const text =
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload, null, 2);
    $('rawOutput').textContent = text.length > 20000 ? `${text.slice(0, 20000)}\n…（已截断）` : text;
    card.hidden = false;
    // 未识别到结构化意见时，默认展开原始输出便于排查
    card.open = !(result.opinions || []).length;
  }

  /** 飞书完整审查报告入口：有链接可直接跳转，没有链接时给出明确说明而不是隐藏按钮。 */
  function renderReportLink(result, source) {
    const link = $('reportLink');
    link.classList.remove('is-disabled');
    link.removeAttribute('aria-disabled');
    link.onclick = null;
    link.hidden = false;
    if (result.reportUrl) {
      link.href = result.reportUrl;
      link.setAttribute('target', '_blank');
      link.textContent = '查看飞书完整审查报告';
      return;
    }
    link.removeAttribute('href');
    link.removeAttribute('target');
    link.setAttribute('aria-disabled', 'true');
    link.classList.add('is-disabled');
    link.textContent = '查看飞书完整审查报告（暂无链接）';
    link.onclick = (event) => {
      event.preventDefault();
      toast(
        source === 'demo'
          ? '当前为演示结果，未生成飞书完整审查报告链接'
          : '本次工作流未返回飞书报告地址，可在“查看工作流原始输出”中核对'
      );
    };
  }

  /* ---------------- Markdown 与导出 ---------------- */

  function buildSuggestionText(opinion) {
    const lines = [
      `【问题标题】${opinion.title}`,
      `【风险等级】${levelLabel(opinion.level)}`,
    ];
    if (opinion.quote) {
      lines.push(`【原文摘录】${opinion.quote}${opinion.quoteSource === 'derived' ? '（本地匹配）' : ''}`);
    }
    if (opinion.analysis) lines.push(`【问题分析】${opinion.analysis}`);
    if (opinion.legalBasis && opinion.legalBasis.length) {
      lines.push(`【法条依据】\n${opinion.legalBasis.map((law) => `- ${law}`).join('\n')}`);
    }
    lines.push(`【修改建议】${opinion.suggestion || '无'}`);
    return lines.join('\n');
  }

  function buildMarkdown(result, contract, meta, source) {
    const counts = result.counts || { high: 0, medium: 0, low: 0, total: (result.opinions || []).length };
    const lines = [
      '# 合同审查意见书',
      '',
      `- 合同名称：${contract.name || '未命名合同'}`,
      `- 合同类型：${contract.type || '未指定'}`,
      `- 审查立场：${contract.stance || '中立'}`,
      `- 审查时间：${formatTime(new Date())}`,
      `- 数据来源：${source === 'coze' ? '扣子工作流' : '演示结果（未调用真实工作流）'}`,
      `- 意见统计：共 ${counts.total} 条（高风险 ${counts.high} 条 / 中风险 ${counts.medium} 条 / 低风险 ${counts.low} 条${
        counts.unknown ? ` / 未分级 ${counts.unknown} 条` : ''
      }）`,
      '',
      '## 一、审查结论',
      '',
      result.conclusion || '未发现可明确判断的问题，仍需人工复核。',
    ];

    if (result.scopeNote) lines.push('', result.scopeNote);

    lines.push('', '## 二、审查意见', '');
    if (!(result.opinions || []).length) {
      lines.push('未发现可明确判断的问题，仍需人工复核。');
    }
    (result.opinions || []).forEach((opinion, index) => {
      lines.push(`### ${index + 1}. 【${levelLabel(opinion.level)}】${opinion.title}`, '');
      if (opinion.quote) {
        lines.push(
          `- 原文摘录：${opinion.quote}${opinion.quoteSource === 'derived' ? '（本地匹配，工作流未返回摘录）' : ''}`
        );
      }
      lines.push(`- 问题分析：${opinion.analysis || '无'}`);
      if (opinion.legalBasis && opinion.legalBasis.length) {
        lines.push('- 法条依据：');
        opinion.legalBasis.forEach((law) => lines.push(`  - ${law}`));
      }
      lines.push(`- 修改建议：${opinion.suggestion || '无'}`, '');
    });

    const legal = result.legalCheck || {};
    lines.push('## 三、法律引用核验', '', `核验状态：${legal.status || '未返回'}`, '');
    if (legal.summary) lines.push(legal.summary, '');
    (legal.items || []).forEach((item) => lines.push(`- ${item.label}${item.value ? `：${item.value}` : ''}`));

    const enterprise = result.enterpriseCheck || {};
    lines.push('', '## 四、企业信息核验', '', `核验状态：${enterprise.status || '未返回'}`, '');
    if (enterprise.name) lines.push(`主体名称：${enterprise.name}`, '');
    (enterprise.items || []).forEach((item) => lines.push(`- ${item.label}：${item.value}`));
    if (enterprise.note) lines.push('', enterprise.note);

    if (result.reportUrl) lines.push('', '## 五、完整审查报告', '', result.reportUrl);
    if (meta && meta.debugUrl) lines.push('', `扣子工作流执行详情：${meta.debugUrl}`);

    lines.push(
      '',
      '---',
      '本审查意见由 AI 工作流生成，法律引用核验与企业信息核验仅供参考，不构成正式法律意见，重要合同请在定稿前由法务人员复核。'
    );
    return lines.join('\n');
  }

  function currentContract() {
    if (state.result && state.result.contract) return state.result.contract;
    const inputs = state.lastRequest || collectInputs();
    return {
      name: inputs.contractName,
      type: inputs.contractType,
      stance: inputs.stance,
      focus: inputs.focus,
      text: inputs.text,
    };
  }

  /* ---------------- 历史记录 ---------------- */

  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeHistory(records) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
    } catch {
      /* 本地存储不可用时忽略 */
    }
  }

  function saveHistory(result, source, contract) {
    const counts = result.counts || { high: 0, total: (result.opinions || []).length };
    const record = {
      name: contract.name || '未命名合同',
      time: formatTime(new Date()),
      total: counts.total || 0,
      high: counts.high || 0,
      source: source === 'coze' ? '扣子工作流' : '演示结果',
    };
    const records = [record, ...readHistory()].slice(0, HISTORY_LIMIT);
    writeHistory(records);
    renderHistory();
  }

  function renderHistory() {
    const records = readHistory();
    const container = $('historyTable');
    container.innerHTML = '';
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '暂无审查记录，完成一次审查后会自动保存在这里。';
      container.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML =
      '<tr><th>合同名称</th><th>审查时间</th><th>意见数量</th><th>高风险</th><th>数据来源</th></tr>';
    const tbody = document.createElement('tbody');
    records.forEach((record) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.className = 'history-name';
      name.textContent = record.name;
      const time = document.createElement('td');
      time.textContent = record.time;
      const total = document.createElement('td');
      total.textContent = `${record.total} 条`;
      const high = document.createElement('td');
      high.innerHTML = `<span class="count-high-text">${record.high}</span> 条`;
      const source = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `source-badge ${record.source === '演示结果' ? 'source-badge--demo' : 'source-badge--coze'}`;
      badge.textContent = record.source;
      source.appendChild(badge);
      tr.append(name, time, total, high, source);
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    document.querySelectorAll('.segmented__item').forEach((item) => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.segmented__item').forEach((other) => {
          other.classList.remove('is-active');
          other.setAttribute('aria-checked', 'false');
        });
        item.classList.add('is-active');
        item.setAttribute('aria-checked', 'true');
      });
    });

    $('contractText').addEventListener('input', () => {
      updateCharCount();
      if ($('contractText').value.trim()) hideFormError();
    });

    $('clearText').addEventListener('click', () => {
      $('contractText').value = '';
      updateCharCount();
      toast('已清空粘贴的合同文本');
    });

    const dropzone = $('dropzone');
    const fileInput = $('fileInput');
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
    });
    ['dragenter', 'dragover'].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'dragend'].forEach((type) => {
      dropzone.addEventListener(type, () => dropzone.classList.remove('is-dragover'));
    });
    dropzone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      const file = event.dataTransfer?.files?.[0];
      if (file) setFile(file);
    });

    $('removeFile').addEventListener('click', (event) => {
      event.stopPropagation();
      clearFile();
      toast('已移除所选文件');
    });

    $('submitBtn').addEventListener('click', () => requestReview(false));
    $('resetBtn').addEventListener('click', resetForm);
    $('reviewAgain').addEventListener('click', () => {
      scrollToNode($('formCard'));
    });

    $('levelFilters').addEventListener('click', (event) => {
      const button = event.target.closest('.filter');
      if (!button) return;
      state.filter = button.dataset.level;
      if (state.result) renderOpinions(state.result);
    });

    $('copyAll').addEventListener('click', () => {
      if (!state.result) return;
      const md = (state.result.opinions || []).map((opinion, index) => `${index + 1}. ${buildSuggestionText(opinion)}`).join('\n\n');
      copyText(md, '已复制全部审查意见');
    });

    $('copyReport').addEventListener('click', () => {
      if (!state.result) return;
      copyText(buildMarkdown(state.result, currentContract(), state.meta, state.source), '已复制审查意见书（Markdown）');
    });

    $('exportPdf').addEventListener('click', () => {
      window.print();
    });

    $('clearHistory').addEventListener('click', () => {
      if (!readHistory().length) {
        toast('当前没有审查记录');
        return;
      }
      if (window.confirm('确定清空本地保存的审查记录吗？此操作不可撤销。')) {
        writeHistory([]);
        renderHistory();
        toast('已清空审查记录');
      }
    });
  }

  function init() {
    bindEvents();
    updateCharCount();
    renderHistory();
    loadStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
