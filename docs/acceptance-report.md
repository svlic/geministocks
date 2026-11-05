# 验收报告 — 2026-11-05

## 结论与证据边界

**可运行开发版已实现，不能宣称整份 PRD 已完整验收或已经上线。** 下表 22 项 Pass、0 项 Fail、2 项 Blocked。Pass 指列明的 fixture/分层契约验证，不代表 24 个场景都完成了真实供应商浏览器端到端测试；实际浏览器贯通的是四种显式 Demo 场景。真实 Grok 调用及真实模型注入对抗尚未执行。

基线 `9d71ac57c628f26cd8f5db96bac0b9f43578dc74`；开发分支 `feat/primary-market-screening`。原 MIT LICENSE 保留。无推送、无云端部署、无生产数据迁移。

## 执行检查

- 基线：安装、类型、178 测试、构建通过。
- 最终本地：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`（15 文件 / **121 测试**）、`pnpm build` 全部 exit 0；`git diff --check` 无错误。
- 依赖警告：Node 内建 SQLite 仍标实验功能；Zod 上游 PURE 注释触发两条非阻断 Rollup 警告。构建产物 JS 330.81 kB / gzip 102.92 kB。
- Chromium：真实 HTTP 登录 → 提交 → worker → 结果；标准/信息不足/策略排除/技术失败四场景，输入锁定、四份 UTF-8 Markdown 下载、Storage 无新增、管理员页面、390px 无横向溢出、无页面异常。后端重启加载最终代码后重新执行通过。
- 已逐张检查最终桌面、移动端、管理员和四类结果截图，保存在本线程 `.amp/in/artifacts/`，不入 Git。失败/策略简版不再显示误导性的分项评分。
- 当前源码入口与生产 bundle 搜索无旧 Polymarket、TACO、股票池、Exa/AnySearch、旧 key/history 服务、旧双分数字段引用。
- GitHub CI 已从 pending 模板改为可执行 Node 24 / pnpm 11 workflow；尚未推送，**未声称远端 CI 已通过**。

## 第 16 节逐项对应

| # | 验收项 | 状态 | 已执行证据 / 限制 |
|---|---|---|---|
| 1 | 极简官网，信息不足结束 | Pass | `orchestrator.test.ts` insufficiency 提前结束；`sufficiency-gate.test.ts` 门槛；HTTP/browser insufficient fixture，总分 null。官网/模型为受控 fixture。 |
| 2 | Seed、10 页 PDF、30% 团队、无补料 | Pass | `app.test.ts` 真实私有 HTTP 上传→真实 10 页子进程提取→标准 Demo，page=1..10；`orchestrator.test.ts` 网站+Deck、PDF-only公开身份确认正反例、独立团队及子项证据评分；浏览器锁定输入。组合模型为 mock，不是完整 live fixture 研究。 |
| 3 | 团队仅有行业专家自述 | Pass | 编排回归输入无姓名的专家自述，输出 founders=[]、团队 insufficient_evidence、团队分及总分 null。 |
| 4 | 同名张三不绑定外部履历 | Pass | 编排回归包含两个同名张三，外部来源无目标公司关联，专业履历被移除。当前为保守字面匹配，不是全面身份真实性证明。 |
| 5 | 仅两家直接可比，不凑数 | Pass | `evidence.test.ts` 允许 2 家、拒绝 adjacent/public_reference 混入 direct；数量上限为 5、无下限。语义可比性仍依赖模型和人工。 |
| 6 | 零直接可比合法 | Pass | evidence test 允许 []；四场景 Demo 无伪造可比/平均估值，UI 明示无可信直接样本。 |
| 7 | 500 万融资不推估值 | Pass | evidence test 固定 amount=5000000、valuation=null，并去重同一融资事件。 |
| 8 | 上市集团参考与分部边界 | Pass | `App.test.tsx` 独立 public_reference、Related segment only / Not a seed valuation proxy、带日期分部说明进入 Markdown；evidence test 抑制无时点财务指标。仅 fixture 渲染和契约验证，未做真实财报分析。 |
| 9 | 硬策略早停 | Pass | 编排回归精确命中私有规则后 brief_policy、team=null、维度/直接可比为空、总分 null；HTTP/browser policy 演示质量与策略分离。 |
| 10 | 策略边界模糊不排除 | Pass | `policy-matcher.test.ts` ambiguous=true、confidence=.84、未配置规则、例外与优先级；模糊返回 unknown。 |
| 11 | 低覆盖不出总分 | Pass | `score-engine.test.ts` 仅两个维度覆盖45%，缺失不是0，totalScore=null。 |
| 12 | 合法评分与75%边界 | Pass | 后端测试75%与85%、未知阶段35%、核心维度门槛；浏览器标准报告暂定68/100、覆盖85%、策略独立。前端只展示后端结果。 |
| 13 | 伪装或未绑定引用 | Pass | evidence test 拒绝未知ID；编排输出非法ID回归转 partial_error，不发布伪verified；gateway 不从 prose URL 生成引用。引用与事实语义仍须人工复核。 |
| 14 | 技术失败不是公司无信息 | Pass | mock 503 编排无demo回退、不泄漏error body；sufficiency技术路径；HTTP/browser失败页无评分、无假材料要求。 |
| 15 | 真实 Grok 原生 Web/X 与统计 | **Blocked** | 原生参数、官方引用/真实usage判定、降级、超时重试有自动测试；模块用量落库。没有真实凭据/付费调用，无法认证实际模型权限及真实X搜索。 |
| 16 | LinkedIn 边界 | Pass | 无登录/验证码绕过实现；公开读取统一 robots/HTTPS/SSRF限制；源码和提示词边界审阅。未新增授权外采集。 |
| 17 | 密钥及匿名保护 | Pass | API测试匿名拒绝、CSRF/Origin、密钥掩码/加密落盘、不回显异常；浏览器localStorage空；gateway测试脱敏。生产TLS/cookie现场另需验证；管理员写入新Key的请求自然包含其输入值。 |
| 18 | 官网/PDF 注入不改策略和100分 | **Blocked** | 结构上仅后端配置可选规则/权重，总分程序计算，客户端prompt override被拒绝，来源为数据。但模型仍决定分类与分项，未执行真实模型恶意官网/PDF对抗，不能用系统提示词或mock证明全面注入防护。 |
| 19 | SSRF、云metadata与内网重定向 | Pass | ingestion tests 覆盖私网/保留地址、IPv6/映射地址、DNS rebinding、重定向、固定socket；HTTP拒绝loopback。 |
| 20 | 大PDF私有直传、损坏/扫描 | Pass | HTTP实际25MiB stream、超限/签名、重复并发PUT；真实PDF子进程40/41页边界、损坏/扫描/Unicode解析。25MiB上传和10页解析分别验证，非25MiB扫描文档OCR。 |
| 21 | 单轮自动完成 | Pass | HTTP/browser四终态、UI partial_error测试；无waiting_for_user_upload、无自动长期追踪；取消和重启恢复API回归。 |
| 22 | 旧功能与调用清除 | Pass | S1物理删除组件/服务/API/worker/重写/旧依赖；入口及构建产物扫描无旧路径；public_reference保留渲染测试。历史文档不作为运行代码。 |
| 23 | 构建质量 | Pass | 最终安装、typecheck、121测试、build、diff检查通过。基线亦通过。 |
| 24 | UTF-8 Markdown | Pass | 标准/简版导出测试含nested团队/上市分部、URL、PDF页码/局限/执行信息；浏览器四份实际下载无key/session字段。 |

## 阶段状态与仍未闭合项

| 阶段 | 状态 |
|---|---|
| S0 | 完成：基线与独立分支，已本地提交。 |
| S1 | 完成：功能减法与单轮UI，已本地提交。 |
| S2 | 开发/本地验证完成：认证、版本配置、加密、SQLite。生产环境验证待执行。 |
| S3 | 开发/本地验证完成：安全网站读取、私有PDF、身份提取契约；无OCR/JS渲染。 |
| S4 | 网关与mock验证完成；真实xAI能力阻塞。 |
| S5 | 主流程、团队各子项理由/来源/充分度、策略/证据门槛本地验证完成；真实研究质量未认证。 |
| S6 | 分项/后端总分/覆盖/报告/导出完成本地验证。 |
| S7 | 本地安全测试、文档、CI配置完成；真实对抗/供应商/生产验收未完成。 |

与完整 PRD 的差异和限制（不能用22项fixture Pass掩盖）：

- Team各子项已分别保存理由/来源/充分度，并将无独立子项依据的分数置null。专业身份关联仍是保守字面规则，可能漏掉别名/音译，事实支持程度需要人工审阅。
- PDF-only公开检索要求Deck明确包含官网，且实际抓取其公开origin确认公司名；未确认不发送搜索。私有路径/查询token不会进入公开检索，不能仅凭模型猜测绑定网站。
- 连通性有供应商错误code和观测工具flags，但未对所有供应商“模型不存在/具体工具权限不足”做稳定细分；真实权限需人工核实。
- 无OCR、图像/复杂表格保真、动态站点渲染；Node子进程非完整OS沙箱；需部署CPU/RSS、存储与备份TTL控制。
- 结构化字段和引用存在不能证明事实正确、真正同细分赛道或独立性。当前不提供自动估值统计，以避免误用融资/集团倍数。
- 七次调用/原生turn预算、超时、单次瞬态重试与用量日志已实现，但不是精确工具call数或货币支出上限。重启恢复可能重复收费，需供应商侧预算。
- 单管理员单实例，无复杂RBAC；原始任务输入/结果并非整库加密；无自动管理员重置/密钥轮换，详见部署说明。

因此交付状态是**本地开发与演示版，不是全部P0验收完成或生产放行**。需要执行Blocked验证并完成部署现场检查后，才能按PRD完整DoD宣告完成。

## 合并交付与架构

前端交付包含中文默认单轮UI、后台配置、引用报告与递归Markdown导出；资料/网关交付包含安全抓取、真实PDF子进程及原生xAI工具适配。主编排将两者接入受保护API、持久队列、配置快照、策略/团队/充分性和后端评分。上述本地测试与浏览器证据是集成结果，不以独立模块报告替代最终验证。

![单轮研究服务与信任边界](https://ampcode.com/artifacts/visuals/15b88b53-7d7f-4008-84c8-2951772f5167)

PDF-only公开检索的关键边界（来自本地后端提交的新增代码）：

```{ .diff file="server/research/orchestrator.ts" }
// @annotation Deck URL 的私有路径和查询参数不能进入公开搜索；先读取公开 origin，确认公司身份后才放行。
+        const publicWebsite=new URL(proposedWebsite).origin;
+        const site=await ingestWebsite(publicWebsite,signal);
+        if(site.evidence.some(e=>e.quoteOrSummary.includes(entity.company!.name!))){
+          input.website=publicWebsite;ledger.push(...site.evidence as Evidence[]);limitations.push(...site.limitations);
// @endannotation
```
