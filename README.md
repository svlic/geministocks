# GeminiStocks · 一级市场单轮初筛

在原 GeminiStocks / Super Digger 仓库上改造的私有研究工具。一次提交创业公司官网、PDF Deck 或两者，自动完成身份识别、策略预筛、证据充分性判断、独立团队分析和简短报告。默认中文，可切换英文。

**项目质量、证据覆盖、基金策略匹配分开呈现；不是投资建议。** 信息不足则结束本轮并列必要材料，不聊天、不补料更新、不建立长期项目库。

## 本地启动

要求 **Node.js ≥24.11.0、pnpm 11.8.0**。SQLite 使用 Node 内建模块，无需额外数据库服务。

```bash copy Copy Setup Commands
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -hex 32
```

将生成值填入 `.env` 的 `CONFIG_ENCRYPTION_KEY`；设置 `ADMIN_PASSWORD`（至少 12 字符）。不要提交 `.env`。两个终端分别运行：

```bash copy Copy Backend Command
pnpm dev:server
```

```bash copy Copy Frontend Command
pnpm dev
```

在启动机器打开 `http://localhost:3000`，以 `.env` 中的管理员账户登录。Vite 代理 `/api` 到 3001。开发模式 Origin 必须与 `APP_ORIGIN` 完全一致；远程访问需使用端口转发或同步修改 Origin。

### 无密钥演示

`.env.example` 默认 `DEMO_MODE=true`。首页有明显虚构标识及标准、信息不足、策略排除、技术失败四种场景。PDF 仍实际校验和解析，但演示分析不读取真实模型、不将虚构公司当作用户上传公司的真实结论。

### 真实研究

将 `DEMO_MODE=false` 后重启后端。在管理员设置添加模型，填写供应商当前支持的 model ID、API Key，分配 `research`、`team`、`synthesis` 角色，保存后测试连接。Key 仅提交给本部署后端，加密落盘，读取只返回掩码。OpenAI 兼容适配器仅支持文本；xAI 使用原生 Responses API 的网页/X 工具。只有所有下游角色明确允许机密处理时，Deck 才会进入模型输入。真实模式出错不会回退演示。

## 架构与运行边界

- React 19 / TypeScript / Vite / Tailwind；浏览器不直连模型，不保存 Key 或长期研究历史。
- `server/app.ts`：认证 HTTP API、私有直传、持久任务 worker；`server/persistence/`：SQLite migration、会话、加密与 TTL。
- `server/ingestion/`：防 SSRF 官网抓取、robots 边界、独立子进程 PDF 文本提取。
- `server/gateway/`：xAI 原生工具与 OpenAI 文本降级；`server/research/`：预筛、团队、综合、证据与后端评分。
- `shared/screening-schema.ts` 为前后端契约；`services/` 只保留同源客户端和 Markdown 导出。
- 常驻 Node **单实例** + 持久卷，不是 Vercel/Workers 临时函数。任务 24 小时过期，原始 PDF 提取后删除，未使用上传 1 小时过期。

详见 [部署与迁移](docs/deployment.md)、[模型与安全](docs/model-and-security.md)、[实施决策](docs/implementation-decisions.md)、[逐项验收](docs/acceptance-report.md)。旧 Cloudflare / Google OAuth / A-share / Jev 文档只作历史资料，不适用于此版本。

## 验证

```bash copy Copy Verification Commands
pnpm typecheck
pnpm test
pnpm build
```

测试中的 xAI 响应为 mock，**不代表真实付费联网已验收**。当前没有真实凭据，live smoke 和生产 TLS/资源限制仍待部署环境验证。PDF 不做 OCR、图片理解；JS-only/登录/反爬站点会产生限制，不绕过访问控制。模型语义、身份消歧及引用对事实的支持程度仍需人工审阅。

## English

Private, single-round early-stage company screening. Submit a public HTTPS website and/or PDF deck, wait for a structured report, and export UTF-8 Markdown. Quality score, evidence coverage, and investment-policy fit remain independent. No chat, trading recommendations, news feed, or persistent project library.

Run the Node backend and Vite frontend with the commands above. Configure server secrets in `.env`, then models through authenticated admin settings. Demo fixtures are explicitly fictional; live failures never silently become demo reports. Deployment requires a persistent single-instance Node 24 service, HTTPS reverse proxy, and private disk volume. Read the acceptance report before production use.

## License

[MIT](LICENSE). Original project by 僧僧 and contributors; original license and copyright retained.
