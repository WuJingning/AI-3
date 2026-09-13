/**
 * 浏览器端演示数据（离线演示模式）。
 *
 * 用途：当页面被部署到只能托管静态文件的平台（例如 GitHub Pages），或本地没有启动
 * `node server.js` 时，页面无法调用真实服务端与扣子工作流。此时由本文件在浏览器本地
 * 生成一份演示审查结果，保证界面与交互可以完整演示。
 *
 * 所有由此生成的结果都会在页面上标注「当前为演示结果」，不会与真实模型结论混淆。
 */
(function () {
  'use strict';

  var FOCUS_OPTIONS = [
    '利率费用合规',
    '风险提示披露',
    '消费者权责条款',
    '违约责任与违约金',
    '个人信息授权',
    '合同解除终止',
  ];

  function clauseOf(text, keywords, fallback) {
    var source = String(text || '');
    if (!source.trim()) return fallback;
    var clauses = source.split(/[\n。；;]+/).map(function (item) {
      return item.trim();
    }).filter(function (item) {
      return item.length >= 6;
    });
    for (var i = 0; i < clauses.length; i += 1) {
      for (var j = 0; j < keywords.length; j += 1) {
        if (clauses[i].indexOf(keywords[j]) !== -1) {
          var clause = clauses[i];
          if (clause.length > 100) {
            var at = clause.indexOf(keywords[j]);
            var start = Math.max(0, at - 30);
            clause = (start > 0 ? '…' : '') + clause.slice(start, start + 80) + '…';
          }
          return clause + '。';
        }
      }
    }
    return fallback;
  }

  var TEMPLATES = {
    credit: {
      match: /借款|贷款|信贷|消费金融|金融服务|分期|信用卡/,
      name: '个人消费借款协议',
      opinions: [
        {
          level: '高',
          tags: ['利率费用合规'],
          title: '息费拆分收取，未披露综合年化成本',
          keys: ['利率', '年化', '利息'],
          quote: '第二条 借款利率：年化利率 36%，另按日计收账户管理费 0.05%。',
          analysis:
            '条款把利息与账户管理费分开约定，未合并折算并披露综合年化融资成本，借款人无法判断真实融资负担；若折算后超过司法保护上限，超出部分存在不被支持的风险。',
          legalBasis: ['《民法典》第六百八十条：禁止高利放贷。', '《中国人民银行公告〔2021〕第3号》：应以明显方式展示年化利率。'],
          suggestion:
            '将利息与各项费用合并折算为综合年化成本，在合同首部以显著方式披露，并确保不超过合同成立时一年期 LPR 的四倍。',
        },
        {
          level: '高',
          tags: ['个人信息授权'],
          title: '个人信息收集超出必要范围，缺少单独同意',
          keys: ['个人信息', '通讯录', '位置', '通话记录', '授权', '信息'],
          quote: '第三条 乙方同意平台收集其通讯录、位置、通话记录等个人信息用于风险控制及营销推广。',
          analysis:
            '概括授权收集通讯录、通话记录等信息并用于营销推广，超出合同履行所必需的范围，且未取得单独同意、未告知保存期限与第三方共享情况。',
          legalBasis: ['《个人信息保护法》第六条、第十四条、第二十三条：最小必要、单独同意与第三方提供告知。'],
          suggestion:
            '按目的逐项列明必要信息，删除与借贷无关的收集项；营销用途单独取得同意并提供撤回方式。',
        },
        {
          level: '高',
          tags: ['违约责任与违约金'],
          title: '违约责任畸重，违约金与剩余利息重复计收',
          keys: ['违约金', '违约', '赔偿'],
          quote: '第四条 乙方发生逾期的，应支付全部剩余利息并另行支付违约金。',
          analysis:
            '在主张全部剩余利息的同时另行计收违约金，且未设置封顶规则，赔偿总额可能显著高于实际损失，属于加重消费者责任的格式条款。',
          legalBasis: ['《民法典》第五百八十五条：违约金过分高于损失的可予适当减少。'],
          suggestion: '将违约金与逾期本金、天数挂钩，并设置与 LPR 四倍上限一致的合计封顶规则。',
        },
        {
          level: '中',
          tags: ['消费者权责条款', '利率费用合规'],
          title: '提前还款仍需支付全部剩余利息',
          keys: ['提前还款', '提前归还', '提前结清', '提前清偿'],
          quote: '乙方提前还款的，仍需支付全部剩余利息及违约金。',
          analysis: '要求消费者为未实际占用的资金支付利息，且未就其产生的费用作显著提示，限制了提前还款的选择权。',
          legalBasis: ['《民法典》第六百七十七条：提前返还借款的，按实际借款期间计算利息。'],
          suggestion: '改为按实际使用期限计息，明确提前还款的申请方式、办理时限及可能产生的合理费用。',
        },
        {
          level: '中',
          tags: ['风险提示披露'],
          title: '风险提示与费用披露不显著，缺少还款示例',
          keys: ['风险提示', '提示', '还款'],
          quote: '',
          analysis: '未以显著方式提示综合年化成本、逾期后果与征信影响，也未提供还款计划示例，难以满足告知说明义务。',
          legalBasis: ['《银行保险机构消费者权益保护管理办法》第二十一条：以显著方式提示重大利害关系内容。'],
          suggestion: '在合同首部增设"重要提示"栏，加粗列明综合年化成本、还款示例与逾期后果，并由借款人签字确认。',
        },
        {
          level: '低',
          tags: ['消费者权责条款'],
          title: '争议管辖约定于出借方所在地，增加维权成本',
          keys: ['管辖', '争议', '诉讼', '法院'],
          quote: '',
          analysis: '格式条款将管辖统一约定在出借方所在地，客观上提高了消费者的维权成本，存在被认定无效的可能。',
          legalBasis: ['《民事诉讼法》第三十五条；《最高人民法院关于适用〈民事诉讼法〉的解释》第三十一条。'],
          suggestion: '改为合同履行地或被告住所地法院管辖，并对该条款作单独提示与确认。',
        },
      ],
    },
    insurance: {
      match: /保险|寿险|重疾|医疗险|投保/,
      name: '保险协议',
      opinions: [
        {
          level: '高',
          tags: ['风险提示披露'],
          title: '免责条款未作显著提示，可能不产生效力',
          keys: ['免责', '除外责任', '不承担'],
          quote: '',
          analysis: '免除保险人责任的条款与其他条款混排，未加粗提示也未明确说明，依法可能不产生效力。',
          legalBasis: ['《保险法》第十七条：对免除保险人责任的条款应作足以引起注意的提示并明确说明。'],
          suggestion: '免责条款单独成栏、加粗呈现，并制作书面说明由投保人签字确认。',
        },
        {
          level: '高',
          tags: ['消费者权责条款', '利率费用合规'],
          title: '退保费用与现金价值计算方式披露不充分',
          keys: ['退保', '现金价值', '犹豫期', '费用'],
          quote: '',
          analysis: '未清晰列明犹豫期起算方式、退保费用扣除标准与现金价值计算方式，消费者难以在投保前判断退保损失。',
          legalBasis: ['《保险法》第十七条；《银行保险机构消费者权益保护管理办法》第二十一条、第二十二条。'],
          suggestion: '在投保单与条款中同时列明犹豫期规则、退保费用比例与现金价值示例，并显著提示退保损失。',
        },
        {
          level: '中',
          tags: ['合同解除终止'],
          title: '自动续保未提供便捷的取消途径',
          keys: ['自动续保', '续期', '自动扣', '扣款'],
          quote: '',
          analysis: '约定自动续保并自动扣划保费，但未明确取消方式与截止时间，也未在扣款前提示，容易引发投诉。',
          legalBasis: ['《银行保险机构消费者权益保护管理办法》第二十五条：不得以默认勾选等方式限制消费者终止服务。'],
          suggestion: '明确取消渠道与截止时间，并在扣款前以短信或站内信提前告知。',
        },
        {
          level: '中',
          tags: ['个人信息授权'],
          title: '健康医疗等敏感信息缺少单独同意',
          keys: ['健康', '医疗', '个人信息', '授权'],
          quote: '',
          analysis: '投保与理赔环节处理健康状况、诊疗记录等敏感个人信息，但仅以概括授权方式处理，未取得单独同意。',
          legalBasis: ['《个人信息保护法》第二十八条、第二十九条、第三十条：敏感个人信息的单独同意与告知。'],
          suggestion: '设置敏感个人信息的单独同意条款，明确处理目的、保存期限与对外提供范围。',
        },
        {
          level: '低',
          tags: ['消费者权责条款'],
          title: '理赔材料与时限约定不完整',
          keys: ['理赔', '索赔', '材料', '核赔'],
          quote: '',
          analysis: '未明确理赔材料清单及补充材料的时限与次数，核赔周期不确定，影响消费者获得赔付的预期。',
          legalBasis: ['《保险法》第二十二条、第二十三条：保险人应及时核定并通知。'],
          suggestion: '列明材料清单与一次性告知义务，约定补充材料次数上限与核定总时限。',
        },
      ],
    },
    wealth: {
      match: /理财|基金|资管|投资|净值/,
      name: '理财协议',
      opinions: [
        {
          level: '高',
          tags: ['风险提示披露'],
          title: '“业绩比较基准”表述易被理解为收益承诺',
          keys: ['业绩比较基准', '预期收益', '收益', '基准'],
          quote: '',
          analysis: '以“业绩比较基准”“预期收益率”描述收益，但未以同等显著程度说明不保本不保证收益，容易使消费者产生收益承诺的误解。',
          legalBasis: ['《关于规范金融机构资产管理业务的指导意见》：不得承诺保本保收益。', '《银行保险机构消费者权益保护管理办法》第二十一条、第二十二条。'],
          suggestion: '改为不含承诺含义的表述，并在同一位置以同等字号提示“业绩比较基准不代表实际收益，可能损失本金”。',
        },
        {
          level: '高',
          tags: ['风险提示披露', '消费者权责条款'],
          title: '风险测评与产品风险等级匹配规则缺失',
          keys: ['风险测评', '风险等级', '适当性', '承受能力'],
          quote: '',
          analysis: '未约定投资者风险承受能力与产品风险等级的匹配规则，也缺少主动购买高风险产品的特别确认程序。',
          legalBasis: ['《银行保险机构消费者权益保护管理办法》第二十条：建立风险承受能力评估与产品风险等级匹配机制。'],
          suggestion: '增加适当性匹配条款，明确测评有效期、风险等级划分与主动购买的特别提示流程。',
        },
        {
          level: '中',
          tags: ['利率费用合规'],
          title: '费用计提与赎回费率披露不完整',
          keys: ['管理费', '托管费', '赎回费', '费用', '费率'],
          quote: '',
          analysis: '仅概括列示管理费、托管费，未说明计提基数、频率与赎回费归属，也未提供费率对收益影响的示例。',
          legalBasis: ['《银行保险机构消费者权益保护管理办法》第二十一条、第二十二条。'],
          suggestion: '补充费用清单表，列明计提基数、频率、支付对象，并给出不同持有期限下的费率示例。',
        },
        {
          level: '低',
          tags: ['合同解除终止'],
          title: '封闭期与赎回限制未在显著位置提示',
          keys: ['封闭期', '赎回', '锁定期', '提前退出'],
          quote: '',
          analysis: '产品存在封闭期或最小持有期限制，但未在显著位置提示，也未说明封闭期内无法赎回的后果。',
          legalBasis: ['《银行保险机构消费者权益保护管理办法》第二十一条；《消费者权益保护法》第八条。'],
          suggestion: '在合同首部与产品要素表中双重提示封闭期安排、赎回开放时间与提前退出限制。',
        },
      ],
    },
  };

  function pickTemplate(contractType) {
    var type = String(contractType || '');
    if (TEMPLATES.credit.match.test(type)) return TEMPLATES.credit;
    if (TEMPLATES.insurance.match.test(type)) return TEMPLATES.insurance;
    if (TEMPLATES.wealth.match.test(type)) return TEMPLATES.wealth;
    return TEMPLATES.credit;
  }

  function buildLegalCheck(template) {
    var items = [];
    template.opinions.forEach(function (opinion) {
      (opinion.legalBasis || []).forEach(function (law) {
        var name = (law.match(/《[^》]+》/) || [])[0];
        if (!name || items.some(function (item) { return item.label === name; })) return;
        items.push({ label: name, value: '已核验 · 现行有效（演示）' });
      });
    });
    return {
      status: '已完成核验（演示数据）',
      summary: '演示模式：以下法条依据为示例整理，正式审查时由扣子工作流逐条核验并标注需复核项。',
      items: items,
    };
  }

  function build(input) {
    var template = pickTemplate(input.contractType);
    var contractText = String(input.text || '').trim();
    var focus = (input.focus || []).filter(function (item) {
      return FOCUS_OPTIONS.indexOf(item) !== -1;
    });

    var opinions = template.opinions.map(function (opinion, index) {
      return {
        id: 'd' + (index + 1),
        level: opinion.level,
        title: opinion.title,
        quote: opinion.keys && opinion.keys.length ? clauseOf(contractText, opinion.keys, opinion.quote) : opinion.quote,
        analysis: opinion.analysis,
        suggestion: opinion.suggestion,
        legalBasis: opinion.legalBasis,
        tags: opinion.tags,
      };
    });

    if (focus.length) {
      var matched = opinions.filter(function (opinion) {
        return (opinion.tags || []).some(function (tag) {
          return focus.indexOf(tag) !== -1;
        });
      });
      if (matched.length >= 3) opinions = matched;
    }

    var counts = { high: 0, medium: 0, low: 0, unknown: 0, total: opinions.length };
    opinions.forEach(function (opinion) {
      if (opinion.level === '高') counts.high += 1;
      else if (opinion.level === '中') counts.medium += 1;
      else if (opinion.level === '低') counts.low += 1;
      else counts.unknown += 1;
    });

    var stance = input.stance || '中立';
    var stanceText =
      stance === '甲方'
        ? '本次以甲方立场演示审查，意见侧重提示条款可能带来的合规瑕疵与举证风险。'
        : stance === '乙方'
          ? '本次以乙方立场演示审查，意见侧重提示加重消费者责任的条款与可主张调整的空间。'
          : '本次以中立立场演示审查，意见侧重监管合规要求与条款对等性。';

    return {
      status: 'ok',
      source: 'demo',
      result: {
        demo: true,
        demoNotice:
          '当前为演示结果：未连接服务端（或未启动 node server.js），本次由浏览器本地示例数据生成，用于展示界面与流程；真实审查需运行服务端并连接扣子工作流。',
        contract: {
          name: input.contractName || '未命名合同',
          type: input.contractType || template.name,
          stance: stance,
          focus: focus.length ? focus : FOCUS_OPTIONS,
          text: contractText,
          charCount: contractText.length,
          hasText: contractText.length > 0,
        },
        counts: counts,
        conclusion:
          '本次演示共生成 ' +
          counts.total +
          ' 条审查意见（高风险 ' +
          counts.high +
          ' 条、中风险 ' +
          counts.medium +
          ' 条、低风险 ' +
          counts.low +
          ' 条）。' +
          stanceText +
          '演示数据仅用于展示报告结构，不构成法律意见。',
        opinions: opinions,
        legalCheck: buildLegalCheck(template),
        enterpriseCheck: {
          status: '演示数据',
          name: '演示主体（未做真实工商核验）',
          note: '演示模式未查询企业信息。真实审查时由扣子工作流查询企业工商、涉诉与处罚信息。',
          items: [
            { label: '核验方式', value: '演示模式未调用企业信息查询' },
            { label: '建议', value: '正式使用时以国家企业信用信息公示系统等公开渠道复核' },
          ],
        },
        reportUrl: '',
        rawOutput: '',
        rawData: null,
        parsed: true,
      },
      meta: {
        transport: '浏览器本地演示数据（未调用服务端）',
        demo: true,
        elapsedMs: 0,
        warnings: [
          '本次结果为浏览器本地演示数据，未调用扣子工作流。真实审查请通过 node server.js 启动服务端，或部署后端服务。',
        ],
      },
    };
  }

  window.ContractReviewDemo = { build: build };
})();
