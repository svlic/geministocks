# GeminiStocks · 一级市场单轮初筛

在原 GeminiStocks / Super Digger 仓库上改造的私有研究工具。一次提交创业公司官网、PDF Deck 或两者，自动完成身份识别、策略预筛、证据充分性判断、独立团队分析和简短报告。默认中文，可切换英文。

**项目质量、证据覆盖、基金策略匹配分开呈现；不是投资建议。** 材料模糊但有依据时允许保守初评分并说明缺口；几乎没有可用依据时结束本轮并列必要材料，不聊天、不补料更新、不建立长期项目库。

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

在启动机器打开 `http://localhost:3000`，以 `.env` 中的管理员账户登录。Vite 代理 `/api` 到 3001。服务端不校验请求 Origin；`APP_ORIGIN` 用于基础 URL 和 Cookie 的 Secure 属性，HTTP 访问时应配置 HTTP 地址。

### 无密钥演示

`.env.example` 默认 `DEMO_MODE=true`。首页有明显虚构标识及标准、信息不足、策略排除、技术失败四种场景。PDF 仍实际校验和解析，但演示分析不读取真实模型、不将虚构公司当作用户上传公司的真实结论。

### 真实研究

将 `DEMO_MODE=false` 后重启后端。在管理员设置添加 OpenAI-compatible 模型，填写 Base URL（不含 `/chat/completions`）、供应商当前支持的 model ID、API Key，分配 `research`、`team`、`synthesis` 角色，保存后测试连接。Key 仅提交给本部署后端，加密落盘，读取只返回掩码。模型统一使用文本 Chat Completions，不接入 xAI native 或模型内置网页/X 工具。只有所有下游角色明确允许机密处理时，Deck 才会进入模型输入。真实模式出错不会回退演示。

可选：在服务端 `.env` 设置 `BRAVE_SEARCH_API_KEY` 后重启服务（Compose 已透传）。每轮以提交的官网域名进行一次 Brave 公开网页搜索，最多安全读取 4 个补充来源，总时限 60 秒；PDF 单独提交时，须先在公开官网确认公司身份才能搜索。搜索不发送 Deck、备注、私有路径或查询参数；搜索摘要、模型生成链接不算证据，只有实际抓取且符合 HTTPS/SSRF/robots 限制的页面才进入报告。未配置 Key、搜索失败或没有可读结果均不阻断已有材料分析，报告如实标记搜索状态。不支持 X 搜索。Key 加密保存在新任务快照中，既有任务不改变，无数据库结构迁移。

空白/少字 PDF 页正常保留为覆盖提示，有文本的页照常分析；没有任何可用文本时输出信息不足简报，而不是伪造内容。官网与 PDF 可相互降级；已完成结果不会因为可选来源、团队或综合模块失败而全部清空。模型格式解析复用现有 JSON 解析器，完整但不符合结构的响应最多纠正一次；网络/超时不盲目重放。真正的解析、配置、模型服务故障仍明确列出，不伪装成研究成功。

初筛不要求先完成独立尽调：具名团队介绍、相关分工或经历等公司材料可支持暂定评分，联网搜不到不等于没有信息。有实质依据但模糊或不完整的维度标为 `partial`，给出 0～2/5 的保守分并解释缺口，后端强制封顶；完全无依据的项保持 null，不自动补零，也不从未披露推断失败。团队子分同样适用，含部分证据子分的团队总维度标为 `partial` 并封顶 2/5。身份仍需明确，材料仍须引用实际来源，公司自述不升级为独立核实。只要存在可用维度就进入分析，不再要求三个核心维度齐全；最终按已评分维度的阶段权重归一化，默认覆盖率达到 5%（含边界）即可展示总分。覆盖率是计分维度的权重合计，包含 `partial`，不是事实核验率或可信度；须结合维度说明阅读。低于门槛仍输出事实与未知项，不强凑总分。未修改的旧默认评分配置（版本 1、门槛 75%）启动时迁移到版本 2、5%；管理员修订过的版本或其他门槛保持不变，可在评分设置中调整。已有任务快照和报告不改写，需新建任务使用新配置。

模型设置中的 **PDF 理解预算**（`pdfUnderstandingTimeoutMs`）默认 5 分钟，可设置为 1～10 分钟，仅对新任务生效并保存在不可变快照中。首次模型理解获准 PDF 文本、提取公司与初步维度，以及最多一次格式纠正，共享这一独立截止时间，不受该模型普通 `timeoutMs`（上限 120 秒）限制；超时明确标记 `pdf_understanding_time_budget_exceeded`，不自动重放请求。此阶段的**实际用时**不计入整轮 8 分钟分析预算和 10 分钟硬上限，但仍计入报告总耗时，且用户取消与服务关闭仍立即生效。其余读取、公开搜索、官网补充后的再次提取、团队和综合调用仍计入原预算：第 8 分钟停止发起新调用并收紧单次超时，为第 10 分钟硬截止前保存结果预留时间。默认配置下整轮最多约 15 分钟；PDF 不可读、未获机密处理许可或仅提交官网时，不启用独立预算。本地 PDF 文本解析仍受原有 20 秒资源上限保护。旧配置和旧快照缺失此字段时使用默认值，无数据库结构迁移、不改写已有快照或结果。

升级时旧 xAI native 模型保留密钥、模型 ID 和服务地址，转为兼容配置并停用；管理员确认兼容端点后再保存启用。旧搜索开关及回合设置自动移除，任务快照和历史结果不改写。尚未完成的 native 任务不会静默切换协议，需使用新配置重新提交。升级前请备份数据库及对应加密密钥，详见 [部署与迁移](docs/deployment.md)。

## Docker Compose 部署（推荐）

要求 Docker Engine 和 Docker Compose v2+，**无需克隆源码，也无需在宿主机安装 Node/pnpm**。只需部署配置文件，应用代码和运行依赖都已包含在镜像中。保持**单实例**；SQLite、加密配置和任务数据存放在命名卷 `screening-data`。

### 1. 配置环境

```bash copy Copy Docker Setup
mkdir geministocks
cd geministocks
curl -fSL https://raw.githubusercontent.com/svlic/geministocks/main/compose.yaml -o compose.yaml
curl -fSL https://raw.githubusercontent.com/svlic/geministocks/main/.env.example -o .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`：将生成值写入 `CONFIG_ENCRYPTION_KEY`，设置至少 12 字符的 `ADMIN_PASSWORD`，将 `APP_ORIGIN` 改为浏览器实际访问的地址（HTTP 或 HTTPS，例如 `https://screening.example.com`，不带路径或末尾斜杠），真实部署设 `DEMO_MODE=false`。应用不强制 HTTPS，也不校验请求 Origin；TLS 和 HSTS 由外层反代管理，会话 Cookie 仅在 `APP_ORIGIN` 为 HTTPS 时带 `Secure`。即使反代到后端使用 HTTP，`APP_ORIGIN` 也应按浏览器端协议配置 Cookie。登录会话和 CSRF Token 校验仍保留。Compose 固定容器内 `HOST=0.0.0.0`、`PORT=3001`、`DATA_DIR=/data`，不使用 `.env.example` 中的开发目录和监听配置。

密钥必须随数据库长期保留，不能在更新/重启时重新生成。管理员密码仅首次初始化生效。密码若包含 `$`，请在 `.env` 中使用单引号包裹，避免 Compose 插值；不要提交 `.env`。

### 2. 启动镜像

GitHub Actions 发布到 `ghcr.io/svlic/geministocks`，同一个标签支持 **linux/amd64 和 linux/arm64**，Docker 自动选择本机架构。

```bash copy Copy Start Containers
docker compose pull
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 app
```

如 GHCR 包尚未公开，先在 GitHub Package 设置中设为 Public，或使用具有 `read:packages` 权限的凭据执行 `docker login ghcr.io`。可在 `.env` 中设置 `IMAGE=ghcr.io/svlic/geministocks:1.2.3` 固定版本；生产建议固定版本或 digest，而非一直使用 `latest`。Fork 部署需将 `IMAGE` 改为自己仓库对应的小写 GHCR 路径。

### 3. 外层反向代理

默认后端仅暴露到宿主机 `127.0.0.1:3001`，不能直接从公网访问。可复用已有外层反代，TLS 和 HSTS 由部署环境管理；不要通过不可信网络明文传输凭据和私有材料。若在**宿主机**使用 Caddy/Nginx，代理到该端口即可。例如 Caddy 的 HTTPS 配置：

```caddyfile copy Copy Caddy Configuration
screening.example.com {
    request_body {
        max_size 26MB
    }
    reverse_proxy 127.0.0.1:3001
}
```

将域名解析到服务器并开放代理的 80/443 端口。若使用 Nginx，设置 `client_max_body_size 26m` 和 `proxy_request_buffering off`，并按后端 30 秒请求超时配置上传超时。代理若也运行在容器中，`127.0.0.1` 指向代理自身；应让它加入应用网络并代理 `app:3001`，不要为此将后端端口暴露到公网。

容器以非 root 用户运行，启用只读根文件系统、临时 `/tmp`、健康检查、日志轮转和默认 2 CPU / 1 GiB 内存 / 128 PID 上限；按实际负载调整 Compose，但不要扩容为多个副本。HTTPS、域名和反向代理由部署环境提供，Compose 不会自动申请证书。上线前仍需验证真实模型及私有 PDF 流程。

### 更新、停止和备份

```bash copy Copy Update Containers
docker compose pull
docker compose up -d --no-build
```

`docker compose down` 停止并删除容器，但保留数据卷。**不要执行 `docker compose down -v`，它会删除数据库。** 备份前停止应用，备份命名卷，并将对应的 `CONFIG_ENCRYPTION_KEY` 单独安全备份；恢复时使用匹配的数据库/密钥和兼容版本。更改 Compose 项目名或部署目录可能创建新卷，迁移时应显式复用原卷。详见 [部署与迁移](docs/deployment.md)。

### 可选：从源码构建

只有需要修改应用代码或自行构建镜像时，才需要克隆仓库。以下命令在独立的源码目录中构建本地镜像，不影响上面的纯镜像部署方式：

```bash copy Copy Build Local Image
git clone https://github.com/svlic/geministocks.git geministocks-source
cd geministocks-source
docker build -t geministocks:local .
```

然后回到已配置好 `.env` 的部署目录，将其中的 `IMAGE` 设置为 `geministocks:local`，执行 `docker compose up -d --no-build --pull never`。后续更新本地代码时，需要重新构建镜像。

### 镜像构建工作流

`.github/workflows/docker.yml` 使用 Buildx + QEMU 构建两个架构：推送 `main` 发布 `latest`、分支及 `sha-*` 标签；推送 `v1.2.3` 等版本标签发布 `1.2.3`、`1.2` 及 `sha-*` 标签（不覆盖 `latest`）；PR 只构建验证、不登录或推送。也支持手动 `workflow_dispatch`。发布使用内置 `GITHUB_TOKEN` 的 `packages: write` 权限，无需另存仓库密码；仓库/组织需允许该权限。

## 架构与运行边界

- React 19 / TypeScript / Vite / Tailwind；浏览器不直连模型，不保存 Key 或长期研究历史。
- `server/app.ts`：认证 HTTP API、私有直传、持久任务 worker；`server/persistence/`：SQLite migration、会话、加密与 TTL。
- `server/ingestion/`：防 SSRF 官网抓取、robots 边界、独立子进程 PDF 文本提取。
- `server/gateway/`：OpenAI-compatible 文本接入；`server/research/`：预筛、团队、综合、证据与后端评分。
- `shared/screening-schema.ts` 为前后端契约；`services/` 只保留同源客户端和 Markdown 导出。
- 常驻 Node **单实例** + 持久卷，不是 Vercel/Workers 临时函数。任务 24 小时过期，原始 PDF 提取后删除，未使用上传 1 小时过期。

详见 [部署与迁移](docs/deployment.md)、[模型与安全](docs/model-and-security.md)、[实施决策](docs/implementation-decisions.md)、[逐项验收](docs/acceptance-report.md)。旧 Cloudflare / Google OAuth / A-share / Jev 文档只作历史资料，不适用于此版本。

## 验证

```bash copy Copy Verification Commands
pnpm typecheck
pnpm test
pnpm build
```

测试中的模型响应和搜索接口为 mock，**不代表真实付费模型或 Brave 搜索已验收**。真实 PDF 子进程、HTTP 上传/任务/结果落盘和桌面/手机报告导出流程已验证；OpenAI-compatible / Brave live smoke 和生产 TLS/资源限制仍待部署环境验证。PDF 不做 OCR、图片理解；JS-only/登录/反爬站点会产生限制，不绕过访问控制。模型语义、身份消歧及引用对事实的支持程度仍需人工审阅。

## English

Private, single-round early-stage company screening. Submit a public HTTPS website and/or PDF deck, wait for a structured report, and export UTF-8 Markdown. Quality score, evidence coverage, and investment-policy fit remain independent. No chat, trading recommendations, news feed, or persistent project library.

For development, run the Node backend and Vite frontend with the commands above. Deployment does not require cloning the repository: download only `compose.yaml` and `.env.example` (save the latter as `.env`), configure a stable encryption key, strong bootstrap password, browser-facing `APP_ORIGIN` (HTTP or HTTPS) and `DEMO_MODE=false`, then run `docker compose pull && docker compose up -d --no-build` behind your reverse proxy. The application does not enforce HTTPS or emit HSTS; TLS/HSTS belong to the proxy, and Secure cookies follow the configured origin's scheme. Clone the source only if you want to build your own image with `docker build`. GHCR images support linux/amd64 and linux/arm64. Keep the named data volume and never use `docker compose down -v` on real data. Configure models through authenticated admin settings. Demo fixtures are explicitly fictional; live failures never silently become demo reports. Read the deployment and acceptance reports before production use.

## License

[MIT](LICENSE). Original project by 僧僧 and contributors; original license and copyright retained.
