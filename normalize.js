/**
 * 把扣子工作流返回的数据整理成前端统一使用的结构。
 * 由于工作流输出结构可能随版本调整，这里采用宽松的字段别名匹配 + 兜底展示原始输出。
 */

const LEVELS = ['高', '中', '低'];

const KEYS = {
  title: ['title', '问题标题', '标题', 'name', 'issue', 'issue_title', 'risk_title', 'risktitle', '问题', '事项', '条款标题'],
  level: ['level', 'risk_level', 'risklevel', 'severity', '风险等级', '等级', '风险级别', 'risk', '严重程度', '风险'],
  quote: ['quote', 'excerpt', 'original', '原文', '原文摘录', '原文引用', 'clause', 'clause_text', '条款', 'content', 'text', '摘录'],
  analysis: ['analysis', '问题分析', '分析', 'description', 'desc', 'detail', 'issue_desc', '问题描述', '说明', 'reason', '风险说明', '评论'],
  suggestion: ['suggestion', '建议', '整改建议', '修改建议', 'recommendation', 'advice', 'fix', 'suggest', '优化建议', '处理建议'],
  legal: ['legal_basis', 'legalbasis', '法条依据', '法律依据', 'law', 'laws', '法律法规', 'regulation', 'regulations', 'legal', '法条', '依据', '引用法条'],
  reportUrl: ['report_url', 'reporturl', 'feishu_url', 'feishuurl', 'feishu_report_url', 'doc_url', 'document_url', '飞书报告地址', '报告地址', '报告链接', '文档链接', 'feishu', '飞书报告', 'report_link', 'report'],
  legalCheck: ['legal_check', 'legalcheck', '法条核验', '法律引用核验', '法律引用核验结果', 'citation_check', 'law_check', 'legal_verify', '法条依据核验', '法律核验'],
  enterprise: ['enterprise', 'enterprise_check', 'company', 'company_info', 'companyinfo', '企业信息', '企业信息核验', '企业信息核验结果', '企业查询', '工商信息', 'enterprise_info'],
};

const ARRAY_KEYS = [
  'opinions', 'opinion_list', 'review_opinions', 'issues', 'risks', 'risk_list', 'items', 'list',
  '审查意见', '审查意见列表', '意见列表', '风险清单', '风险点', '问题清单', '审查结果', 'review_result', 'results', 'data',
];

function parseMaybeJson(value, depth = 0) {
  if (depth > 4 || typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return '';
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      return parseMaybeJson(JSON.parse(text), depth + 1);
    } catch {
      return value;
    }
  }
  return value;
}

/** 递归解析嵌套的 JSON 字符串（工作流常把结果放在 output / result 字段里）。 */
function deepParse(node, depth = 0) {
  if (depth > 5) return node;
  const parsed = typeof node === 'string' ? parseMaybeJson(node) : node;
  if (Array.isArray(parsed)) return parsed.map((entry) => deepParse(entry, depth + 1));
  if (parsed && typeof parsed === 'object') {
    const output = {};
    for (const [key, value] of Object.entries(parsed)) {
      output[key] = value && typeof value === 'object' ? deepParse(value, depth + 1) : typeof value === 'string' ? deepParse(value, depth + 1) : value;
    }
    return output;
  }
  return parsed;
}

function lowerKeyMap(object) {
  const map = new Map();
  for (const [key, value] of Object.entries(object)) map.set(key.toLowerCase().replace(/[\s_-]/g, ''), value);
  return map;
}

function pick(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const map = lowerKeyMap(object);
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[\s_-]/g, '');
    if (map.has(normalized)) {
      const value = map.get(normalized);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
}

function toText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const preferred = pick(value, ['text', 'content', 'value', 'name', 'title', '说明', '内容']);
    if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
    return Object.entries(value)
      .map(([key, entry]) => `${key}：${toText(entry)}`)
      .filter((line) => !line.endsWith('：'))
      .join('；');
  }
  return '';
}

export function normalizeLevel(value) {
  const text = toText(value).toLowerCase();
  if (!text) return '';
  if (/高|严重|重大|紧急|high|critical|h$|红|3/.test(text)) return '高';
  if (/中|一般|中等|medium|middle|moderate|m$|黄|2/.test(text)) return '中';
  if (/低|轻微|提示|low|minor|l$|蓝|1/.test(text)) return '低';
  return '';
}

function looksLikeOpinion(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const hasTitle = Boolean(pick(object, KEYS.title) || pick(object, KEYS.level));
  const hasBody = Boolean(
    pick(object, KEYS.analysis) || pick(object, KEYS.suggestion) || pick(object, KEYS.quote) || pick(object, KEYS.legal)
  );
  return hasTitle && hasBody;
}

function toOpinion(object, index) {
  const title = toText(pick(object, KEYS.title)) || `审查意见 ${index + 1}`;
  const level = normalizeLevel(pick(object, KEYS.level));
  const quote = toText(pick(object, KEYS.quote));
  const analysis = toText(pick(object, KEYS.analysis));
  const suggestion = toText(pick(object, KEYS.suggestion));
  const legalRaw = pick(object, KEYS.legal);
  const legalBasis = Array.isArray(legalRaw)
    ? legalRaw.map(toText).filter(Boolean)
    : toText(legalRaw)
      ? [toText(legalRaw)]
      : [];
  return {
    id: `o${index + 1}`,
    level,
    title,
    quote,
    analysis,
    suggestion,
    legalBasis,
  };
}

function collectOpinions(node, out, depth = 0) {
  if (depth > 6 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    const objects = node.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    const opinionObjects = objects.filter(looksLikeOpinion);
    if (opinionObjects.length) {
      for (const entry of opinionObjects) out.push(entry);
      return;
    }
    const strings = node.filter((entry) => typeof entry === 'string' && entry.trim().length > 20);
    if (objects.length === 0 && strings.length === node.length && node.length > 1) {
      for (const entry of strings) out.push({ 问题标题: inferTitle(entry), 风险等级: '中', 问题分析: entry });
      return;
    }
    for (const entry of node) collectOpinions(entry, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    if (looksLikeOpinion(node)) {
      out.push(node);
      return;
    }
    for (const key of ARRAY_KEYS) {
      const normalized = key.toLowerCase().replace(/[\s_-]/g, '');
      const hit = Object.entries(node).find(([k]) => k.toLowerCase().replace(/[\s_-]/g, '') === normalized);
      if (hit) collectOpinions(hit[1], out, depth + 1);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') collectOpinions(value, out, depth + 1);
    }
  }
}

function inferTitle(text) {
  const firstLine = String(text).split(/[\n。；;]/)[0] || '审查意见';
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

function findFirst(node, keys, depth = 0) {
  if (depth > 6 || !node || typeof node !== 'object') return undefined;
  const hit = pick(node, keys);
  if (hit !== undefined) return hit;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const nested = findFirst(value, keys, depth + 1);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function findReportUrl(node, depth = 0) {
  if (depth > 6 || !node || typeof node !== 'object') return '';
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      const normalizedKey = key.toLowerCase();
      if (/(feishu|飞书|lark|report|报告|doc|文档|link|url)/.test(normalizedKey) && !/auth|oauth|login/i.test(value)) {
        if (/(feishu|larkoffice|larksuite|docs\.|docx)/i.test(value) || /报告|文档/.test(key)) return value;
      }
    }
  }
  const nested = findFirst(node, KEYS.reportUrl);
  const nestedText = toText(nested);
  const match = nestedText.match(/https?:\/\/[^\s"'）)]+/);
  if (match && !/oauth|authen/i.test(match[0])) return match[0];

  const whole = JSON.stringify(node);
  const fallback = whole.match(/https?:\/\/[^\s"\\]*(?:feishu|larkoffice|larksuite)[^\s"\\]*/i);
  return fallback ? fallback[0].replace(/\\u0026/g, '&') : '';
}

function buildLegalCheck(raw) {
  if (!raw) return { status: '', summary: '', items: [] };
  if (typeof raw === 'string') return { status: '已完成', summary: raw, items: [] };
  const summary = toText(pick(raw, ['summary', '摘要', '结论', 'result', 'status', '状态', '说明']));
  const listRaw =
    pick(raw, ['items', 'list', 'details', '结果', '明细', 'citations', 'laws', '法律引用']) ?? raw;
  const items = [];
  if (Array.isArray(listRaw)) {
    for (const entry of listRaw) {
      if (typeof entry === 'string') {
        items.push({ label: entry, value: '' });
      } else if (entry && typeof entry === 'object') {
        items.push({
          label: toText(pick(entry, ['law', '法条', 'name', '名称', 'citation', 'title', '法规'])) || toText(entry),
          value: toText(pick(entry, ['status', '状态', 'note', '说明', 'result', '核验结果', 'conclusion'])) || '',
        });
      }
    }
  } else if (typeof listRaw === 'object') {
    for (const [key, value] of Object.entries(listRaw)) items.push({ label: key, value: toText(value) });
  }
  const texts = [raw].flatMap((entry) => (typeof entry === 'object' ? Object.values(entry) : [entry])).map(toText);
  return { status: summary || '已完成', summary: summary || texts.filter(Boolean).slice(0, 2).join(' '), items };
}

function buildEnterpriseCheck(raw) {
  if (!raw) return { name: '', items: [], note: '', status: '' };
  if (typeof raw === 'string') return { name: '', items: [], note: raw, status: '已完成' };
  const name = toText(pick(raw, ['company_name', 'name', '企业名称', '公司名称', '主体名称']));
  const status = toText(pick(raw, ['status', '状态', '核验结果', 'conclusion', '结论']));
  const note = toText(pick(raw, ['summary', '摘要', '说明', 'note', '备注', '风险提示']));
  const items = [];
  for (const [key, value] of Object.entries(raw)) {
    if (['企业名称', '公司名称', 'name', 'company_name', 'status', 'summary', 'note', '备注', '说明'].includes(key)) continue;
    const text = toText(value);
    if (!text) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [subKey, subValue] of Object.entries(value)) {
        const subText = toText(subValue);
        if (subText) items.push({ label: subKey, value: subText });
      }
    } else {
      items.push({ label: key, value: text });
    }
  }
  return { name, items, note, status: status || '已完成' };
}

function buildConclusion(counts) {
  if (!counts.total) return '未发现可明确判断的问题，仍需人工复核。';
  const unknown = counts.unknown ? `、未分级 ${counts.unknown} 条` : '';
  return `本次审查共发现 ${counts.total} 条审查意见，其中高风险 ${counts.high} 条、中风险 ${counts.medium} 条、低风险 ${counts.low} 条${unknown}。建议优先处理高风险条款，并在定稿前完成法务复核。`;
}

function countByLevel(opinions) {
  const counts = { high: 0, medium: 0, low: 0, unknown: 0, total: opinions.length };
  for (const opinion of opinions) {
    if (opinion.level === '高') counts.high += 1;
    else if (opinion.level === '中') counts.medium += 1;
    else if (opinion.level === '低') counts.low += 1;
    else counts.unknown += 1;
  }
  return counts;
}

/* ---------------- Markdown 报告解析 ----------------
 * 实际工作流返回的是 Markdown 文本，形如：
 *   ### 审查意见清单
 *   - 问题1：标题
 *     - 风险等级：高
 *     - 原文摘录：……
 *     - 分析：……
 *     - 法条依据：……
 *     - 修改建议：……
 *   ### 法律引用核验结果 / ### 企业信息核验结果 / ### 完整审查报告
 */

const MD_FIELDS = {
  风险等级: 'level',
  风险级别: 'level',
  等级: 'level',
  严重程度: 'level',
  原文摘录: 'quote',
  原文引用: 'quote',
  原文: 'quote',
  摘录: 'quote',
  问题分析: 'analysis',
  风险分析: 'analysis',
  分析: 'analysis',
  问题描述: 'analysis',
  法条依据: 'legal',
  法律依据: 'legal',
  法条: 'legal',
  引用法条: 'legal',
  修改建议: 'suggestion',
  整改建议: 'suggestion',
  优化建议: 'suggestion',
  建议: 'suggestion',
};

function splitMarkdownSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  let current = { title: '', lines: [] };
  for (const line of lines) {
    const heading = detectHeading(line);
    const separator = /^\s*(-{3,}|={3,})\s*$/.test(line);
    if (heading) {
      if (current.title || current.lines.some((item) => item.trim())) sections.push(current);
      current = { title: heading.title, lines: heading.trailing ? [heading.trailing] : [] };
      continue;
    }
    if (separator) continue;
    current.lines.push(line);
  }
  if (current.title || current.lines.some((item) => item.trim())) sections.push(current);
  return sections;
}

/** 识别章节标题：支持 ### 标题，也支持 “2）法律引用核验结果：正文” 这类写法。 */
function detectHeading(line) {
  const markdown = line.match(/^\s{0,3}#{1,6}\s*(.+?)\s*$/);
  if (markdown) return { title: markdown[1].replace(/[#*]/g, '').trim(), trailing: '' };

  const numbered = line.match(
    /^\s*(?:[0-9]+[）)、.．]|[（(]\s*[0-9一二三四五六七八九十]+\s*[)）])\s*([^：:]{2,24}?)\s*(?:[:：]\s*(.*))?$/
  );
  if (numbered) {
    const title = numbered[1].trim();
    if (/(审查意见清单|法律引用核验|企业信息核验|完整审查报告|审查意见|风险清单|问题清单|核验结果|企业信息|法律引用)/.test(title)) {
      return { title, trailing: (numbered[2] || '').trim() };
    }
  }
  return null;
}

function parseOpinionSection(lines) {
  const opinions = [];
  let current = null;

  const pushField = (field, value) => {
    if (!current || !value) return;
    if (field === 'legal') {
      const parts = value
        .split(/[、；;]/)
        .map((item) => item.trim())
        .filter(Boolean);
      current.legal = [...(current.legal || []), ...(parts.length ? parts : [value])];
      return;
    }
    if (field === 'level') {
      current.level = value;
      return;
    }
    current[field] = current[field] ? `${current[field]}\n${value}` : value;
  };

  for (const rawLine of lines) {
    // 去掉 Markdown 强调符号与引用符号，避免 **风险等级**：高 之类的写法无法识别
    const line = String(rawLine)
      .replace(/\u00a0/g, ' ')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/\*\*|__|`/g, '')
      .replace(/(^|[\s(（])_([^_]+)_(?=[\s)）。，]|$)/g, '$1$2');
    if (!line.trim()) continue;

    const titleMatch =
      line.match(/^\s*(?:[-•]\s*|\*\s+)?问题\s*[0-9一二三四五六七八九十]*\s*[:：]\s*(.+?)\s*$/) ||
      line.match(/^\s*(?:[-•]\s*|\*\s+)?问题标题\s*[:：]\s*(.+?)\s*$/) ||
      line.match(/^\s*(?:[-•]\s*|\*\s+)?意见标题\s*[:：]\s*(.+?)\s*$/) ||
      line.match(/^\s*(?:[-•]\s*|\*\s+)?[0-9]+\s*[.、)]\s*(.+?)\s*$/) ||
      line.match(/^\s*(?:[-•]\s*|\*\s+)?[（(]\s*[0-9一二三四五六七八九十]+\s*[)）]\s*(.+?)\s*$/);
    if (titleMatch) {
      current = { title: titleMatch[1].trim(), legal: [], rawLines: [line.trim()] };
      opinions.push(current);
      continue;
    }

    const fieldMatch = line.match(/^\s*(?:[-•]\s*|\*\s+)?([\u4e00-\u9fa5A-Za-z]{2,8})\s*[:：]\s*(.*)$/);
    if (fieldMatch && MD_FIELDS[fieldMatch[1].trim()]) {
      if (current) current.rawLines.push(line.trim());
      pushField(MD_FIELDS[fieldMatch[1].trim()], fieldMatch[2].trim());
      continue;
    }

    // 续行：无字段名的换行文本，追加到当前意见最近的字段
    if (current) {
      current.rawLines.push(line.trim());
      const target = current.suggestion ? 'suggestion' : current.analysis ? 'analysis' : current.quote ? 'quote' : 'title';
      if (target === 'title') current.title = `${current.title}${line.trim()}`;
      else current[target] = `${current[target]}\n${line.trim()}`;
    }
  }

  return opinions.map((entry) => resolveInlineFields(entry));
}

/**
 * 兜底解析：部分运行结果会把字段写在同一行里，例如
 * “- 分析：原文摘录：第二条……。风险等级为重大。该条款……法条依据：……整改建议：……”，
 * 这里按行内标签再切分一次，只补齐缺失字段。
 */
function resolveInlineFields(entry) {
  if (!Array.isArray(entry.rawLines) || !entry.rawLines.length) return entry;

  const text = entry.rawLines.join(' ');
  const labelPattern =
    '(问题分析|风险分析|原文摘录|原文引用|原文|风险等级为|风险等级|风险级别|等级为|法条依据|法律依据|引用法条|整改建议|修改建议|优化建议|建议|分析)';
  const matcher = new RegExp(`${labelPattern}\\s*[:：为]\\s*`, 'g');
  const marks = [];
  let match;
  while ((match = matcher.exec(text)) !== null) {
    marks.push({ label: match[1], start: match.index, valueStart: matcher.lastIndex });
  }
  if (marks.length < 2) return entry;

  const segments = marks.map((mark, index) => ({
    label: mark.label,
    value: text.slice(mark.valueStart, index + 1 < marks.length ? marks[index + 1].start : text.length).trim(),
  }));

  const clean = (value) => value.replace(/^[：:、，,。；;\s]+/, '').replace(/[。；;\s]+$/, '').trim();

  const best = { quote: '', legal: '', suggestion: '', analysis: [] };
  const strengths = { quote: 0, legal: 0, suggestion: 0 };
  let level = '';
  let levelRest = '';

  for (const segment of segments) {
    const label = segment.label;
    const value = clean(segment.value);
    if (!value && label !== '风险等级为' && label !== '风险等级') continue;

    if (/原文摘录|原文引用|原文/.test(label)) {
      if (label.length >= strengths.quote && value) {
        strengths.quote = label.length;
        best.quote = value;
      }
    } else if (/风险等级|风险级别|等级/.test(label)) {
      const head = value.split(/[。，,、；;\s]/)[0] || '';
      const parsed = normalizeLevel(head);
      if (parsed && !level) level = parsed;
      const rest = clean(value.slice(head.length));
      if (rest && !levelRest) levelRest = rest;
    } else if (/法条依据|法律依据|引用法条/.test(label)) {
      if (label.length >= strengths.legal && value) {
        strengths.legal = label.length;
        best.legal = value;
      }
    } else if (/整改建议|修改建议|优化建议|建议/.test(label)) {
      if (label.length >= strengths.suggestion && value) {
        strengths.suggestion = label.length;
        best.suggestion = value;
      }
    } else if (/问题分析|风险分析|分析/.test(label)) {
      if (value) best.analysis.push(value);
    }
  }

  if (best.quote) entry.quote = best.quote;
  if (level) entry.level = level;
  if (best.legal) {
    const parts = best.legal
      .split(/[、；;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    entry.legal = parts.length ? parts : [best.legal];
  }
  if (best.suggestion) entry.suggestion = best.suggestion;

  // 分析正文 = “分析”标签后的内容 + “风险等级为X。”之后剩余的正文
  const analysisText = [...best.analysis, levelRest].map((item) => clean(item)).filter(Boolean).join(' ');
  if (analysisText) entry.analysis = analysisText;
  else if (entry.analysis) {
    entry.analysis = entry.analysis
      .replace(
        /(原文摘录|原文引用|风险等级为|风险等级|风险级别|法条依据|法律依据|引用法条|整改建议|修改建议|优化建议|问题分析|风险分析|分析)\s*[:：]\s*/g,
        ' '
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return entry;
}

function toMarkdownOpinion(entry, index) {
  return {
    id: `m${index + 1}`,
    level: normalizeLevel(entry.level),
    title: toText(entry.title) || `审查意见 ${index + 1}`,
    quote: toText(entry.quote),
    analysis: toText(entry.analysis),
    suggestion: toText(entry.suggestion),
    legalBasis: Array.isArray(entry.legal) ? entry.legal.filter(Boolean) : [],
  };
}

function findMarkdownReview(root) {
  const candidates = [];
  const visit = (node, depth = 0) => {
    if (depth > 3) return;
    if (typeof node === 'string') {
      if (node.length >= 120 && /风险等级|审查意见|问题\s*[0-9一二三四五六七八九十]/.test(node)) candidates.push(node);
      return;
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) visit(value, depth + 1);
    }
  };
  visit(root);
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] || '';
}

function parseMarkdownReview(markdown) {
  const sections = splitMarkdownSections(markdown);
  const output = { opinions: [], legal: '', enterprise: '', report: '' };
  const opinionSection = sections.find((section) => /审查意见|风险清单|问题清单|意见清单/.test(section.title));

  if (opinionSection) {
    output.opinions = parseOpinionSection(opinionSection.lines).map(toMarkdownOpinion);
  }
  if (!output.opinions.length) {
    output.opinions = parseOpinionSection(String(markdown).split(/\r?\n/)).map(toMarkdownOpinion);
  }

  const pickSection = (pattern) => {
    const section = sections.find((item) => pattern.test(item.title));
    return section ? section.lines.join('\n').trim() : '';
  };
  output.legal = pickSection(/法律引用核验|法条核验|法律核验|引用核验/);
  output.enterprise = pickSection(/企业信息核验|企业核验|工商信息/);
  output.report = pickSection(/完整审查报告|审查报告|审查结论/);
  return output;
}

/** 提取工作流返回的短结论字段（例如 output1 表示法条核验结论）。 */
function collectShortNotes(root) {
  const notes = { legal: [], enterprise: [] };
  if (!root || typeof root !== 'object') return notes;
  for (const [key, value] of Object.entries(root)) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || text.length > 200) continue;
    if (!/^(output\d*|.*核验.*|.*结论.*|.*备注.*|.*note.*)$/i.test(key) && !/核验|复核/.test(text)) continue;
    if (/法条|法规|法律|旧法|引用/.test(text)) notes.legal.push(text);
    else if (/企业|公司|工商|经营|资质/.test(text)) notes.enterprise.push(text);
  }
  return notes;
}

export function normalizeWorkflowResult(rawData) {
  const root = deepParse(parseMaybeJson(rawData));
  const collected = [];
  collectOpinions(root, collected);

  const seen = new Set();
  const opinions = [];
  for (const entry of collected) {
    if (!entry || typeof entry !== 'object') continue;
    if (!looksLikeOpinion(entry)) continue;
    const opinion = toOpinion(entry, opinions.length);
    const fingerprint = `${opinion.title}|${opinion.quote}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    opinions.push(opinion);
  }

  const counts = countByLevel(opinions);
  const rawOutput =
    typeof root === 'string'
      ? root
      : toText(pick(root, ['output', 'result', 'message', 'content', 'text', '报告', 'markdown']));

  const markdown = findMarkdownReview(root);
  const markdownReview = markdown
    ? parseMarkdownReview(markdown)
    : { opinions: [], legal: '', enterprise: '', report: '' };
  for (const opinion of markdownReview.opinions) {
    const fingerprint = `${opinion.title}|${opinion.quote}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    opinions.push(opinion);
  }
  const finalCounts = countByLevel(opinions);
  const shortNotes = collectShortNotes(root);

  const legalCheck = buildLegalCheck(findFirst(root, KEYS.legalCheck) ?? pick(root, KEYS.legalCheck));
  if (!legalCheck.summary && markdownReview.legal) legalCheck.summary = markdownReview.legal;
  if (!legalCheck.status && shortNotes.legal.length) legalCheck.status = shortNotes.legal[0];
  if (!legalCheck.status && markdownReview.legal) legalCheck.status = '已完成核验';
  if (!legalCheck.items.length && markdownReview.legal) {
    const laws = Array.from(new Set(Array.from(markdownReview.legal.matchAll(/《[^》]+》/g)).map((match) => match[0])));
    const note = shortNotes.legal[0] || '';
    const status = /未发现.*(旧法|失效|废止)/.test(note)
      ? '现行有效（需人工复核）'
      : note || '需人工复核';
    legalCheck.items = laws.length
      ? laws.map((law) => ({ label: law, value: status }))
      : [{ label: '核验结论', value: markdownReview.legal.slice(0, 160) }];
  }

  const enterpriseCheck = buildEnterpriseCheck(
    findFirst(root, KEYS.enterprise) ?? pick(root, KEYS.enterprise)
  );
  if (markdownReview.enterprise) {
    const nameMatch = markdownReview.enterprise.match(
      /([\u4e00-\u9fa5A-Za-z0-9（）()]{2,40}?(?:有限公司|股份有限公司|银行|保险股份有限公司|信用社|集团))/
    );
    if (!enterpriseCheck.name && nameMatch) {
      enterpriseCheck.name = nameMatch[1].replace(/^(甲方|乙方|合作方|主体|公司名称|企业名称)[为是：:\s]*/, '');
    }
    if (enterpriseCheck.note && enterpriseCheck.note !== markdownReview.enterprise) {
      enterpriseCheck.items = [
        ...(enterpriseCheck.items || []),
        { label: '企业查询节点返回', value: enterpriseCheck.note },
      ];
      enterpriseCheck.note = markdownReview.enterprise;
    } else {
      enterpriseCheck.note = enterpriseCheck.note || markdownReview.enterprise;
    }
    enterpriseCheck.summary = enterpriseCheck.summary || markdownReview.enterprise;
  }
  for (const note of shortNotes.enterprise) {
    if (note === enterpriseCheck.note || note === enterpriseCheck.summary || note === enterpriseCheck.name) continue;
    enterpriseCheck.items = [...(enterpriseCheck.items || []), { label: '企业查询节点返回', value: note }];
  }
  if (!enterpriseCheck.status && (enterpriseCheck.name || enterpriseCheck.note || (enterpriseCheck.items || []).length)) {
    enterpriseCheck.status = '已完成';
  }

  const reportSummary = markdownReview.report || '';
  return {
    opinions,
    counts: finalCounts,
    conclusion: reportSummary || buildConclusion(finalCounts),
    scopeNote: reportSummary ? buildConclusion(finalCounts) : '',
    legalCheck,
    enterpriseCheck,
    reportUrl: findReportUrl(root),
    rawOutput: typeof rawOutput === 'string' ? rawOutput.trim() : '',
    rawData: root,
    parsed: opinions.length > 0,
  };
}

function ngrams(text, size = 3) {
  const value = String(text || '').replace(/\s+/g, '');
  const grams = new Set();
  for (let index = 0; index + size <= value.length; index += 1) grams.add(value.slice(index, index + size));
  return grams;
}

/**
 * 部分工作流运行结果不返回“原文摘录”，此时在本地按关键词重合度从合同原文中匹配对应条款，
 * 并在页面上标注为“本地匹配”。仅用于阅读定位，不改变工作流给出的分析与建议。
 */
export function attachDerivedQuotes(opinions, contractText) {
  const text = String(contractText || '');
  if (!text.trim() || !Array.isArray(opinions)) return opinions;
  const clauses = text
    .split(/[\n。；;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
  if (!clauses.length) return opinions;
  const clauseGrams = clauses.map((clause) => ngrams(clause));

  for (const opinion of opinions) {
    if (opinion.quote) continue;
    const query = `${opinion.title || ''}${opinion.analysis || ''}${opinion.suggestion || ''}`;
    const queryGrams = ngrams(query);
    if (queryGrams.size < 4) continue;

    let bestIndex = -1;
    let bestScore = 0;
    clauseGrams.forEach((set, index) => {
      let score = 0;
      for (const gram of queryGrams) if (set.has(gram)) score += 1;
      if (score > bestScore || (score === bestScore && score > 0 && index > -1 && bestIndex >= 0 && clauses[index].length < clauses[bestIndex].length)) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex === -1 || bestScore < 4) continue;
    const clause = clauses[bestIndex];
    opinion.quote = clause.length > 160 ? `${clause.slice(0, 160)}…` : clause;
    opinion.quoteSource = 'derived';
  }
  return opinions;
}

export { LEVELS };
