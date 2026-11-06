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

## Docker Compose 部署（推荐）

要求 Docker Engine 和 Docker Compose v2+，无需在宿主机安装 Node/pnpm。保持**单实例**；SQLite、加密配置和任务数据存放在命名卷 `screening-data`。

### 1. 配置环境

```bash copy Copy Docker Setup
git clone https://github.com/svlic/geministocks.git
cd geministocks
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
```

编辑 `.env`：将生成值写入 `CONFIG_ENCRYPTION_KEY`，设置至少 12 字符的 `ADMIN_PASSWORD`，将 `APP_ORIGIN` 改为实际的 HTTPS 地址（例如 `https://screening.example.com`，不带路径或末尾斜杠），真实部署设 `DEMO_MODE=false`。Compose 固定容器内 `HOST=0.0.0.0`、`PORT=3001`、`DATA_DIR=/data`，不使用 `.env.example` 中的开发目录和监听配置。

密钥必须随数据库长期保留，不能在更新/重启时重新生成。管理员密码仅首次初始化生效。密码若包含 `$`，请在 `.env` 中使用单引号包裹，避免 Compose 插值；不要提交 `.env`。

### 2. 启动镜像

GitHub Actions 发布到 `ghcr.io/svlic/geministocks`，同一个标签支持 **linux/amd64 和 linux/arm64**，Docker 自动选择本机架构。

```bash copy Copy Start Containers
docker compose pull
docker compose up -d --no-build
docker compose ps
docker compose logs --tail=100 app
```

首次 Actions 成功发布前，或需要运行本地修改时，可直接从源码构建：

```bash copy Copy Build Containers
docker compose up -d --build --pull never
```

如 GHCR 包尚未公开，先在 GitHub Package 设置中设为 Public，或使用具有 `read:packages` 权限的凭据执行 `docker login ghcr.io`。可在 `.env` 中设置 `IMAGE=ghcr.io/svlic/geministocks:1.2.3` 固定版本；生产建议固定版本或 digest，而非一直使用 `latest`。Fork 部署需将 `IMAGE` 改为自己仓库对应的小写 GHCR 路径。

### 3. HTTPS 反向代理

默认后端仅暴露到宿主机 `127.0.0.1:3001`，不能直接从公网访问。在**宿主机**已有的 Caddy/Nginx 上配置 TLS，代理到该端口，并保持请求 Origin 不变。例如 Caddy：

```caddyfile copy Copy Caddy Configuration
screening.example.com {
    request_body {
        max_size 26MB
    }
    reverse_proxy 127.0.0.1:3001
}
```

将域名解析到服务器并开放代理的 80/443 端口；域名须与 `APP_ORIGIN` 完全一致。若使用 Nginx，设置 `client_max_body_size 26m` 和 `proxy_request_buffering off`，并按后端 30 秒请求超时配置上传超时。代理若也运行在容器中，`127.0.0.1` 指向代理自身；应让它加入应用网络并代理 `app:3001`，不要为此将后端端口暴露到公网。

容器以非 root 用户运行，启用只读根文件系统、临时 `/tmp`、健康检查、日志轮转和默认 2 CPU / 1 GiB 内存 / 128 PID 上限；按实际负载调整 Compose，但不要扩容为多个副本。HTTPS、域名和反向代理由部署环境提供，Compose 不会自动申请证书。上线前仍需验证真实模型及私有 PDF 流程。

### 更新、停止和备份

```bash copy Copy Update Containers
docker compose pull
docker compose up -d --no-build
```

`docker compose down` 停止并删除容器，但保留数据卷。**不要执行 `docker compose down -v`，它会删除数据库。** 备份前停止应用，备份命名卷，并将对应的 `CONFIG_ENCRYPTION_KEY` 单独安全备份；恢复时使用匹配的数据库/密钥和兼容版本。更改 Compose 项目名或部署目录可能创建新卷，迁移时应显式复用原卷。详见 [部署与迁移](docs/deployment.md)。

### 镜像构建工作流

`.github/workflows/docker.yml` 使用 Buildx + QEMU 构建两个架构：推送 `main` 发布 `latest`、分支及 `sha-*` 标签；推送 `v1.2.3` 等版本标签发布 `1.2.3`、`1.2` 及 `sha-*` 标签（不覆盖 `latest`）；PR 只构建验证、不登录或推送。也支持手动 `workflow_dispatch`。发布使用内置 `GITHUB_TOKEN` 的 `packages: write` 权限，无需另存仓库密码；仓库/组织需允许该权限。

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

For development, run the Node backend and Vite frontend with the commands above. For deployment, configure `.env` with a stable encryption key, strong bootstrap password, HTTPS `APP_ORIGIN` and `DEMO_MODE=false`, then run `docker compose pull && docker compose up -d --no-build` behind an HTTPS reverse proxy. Alternatively build locally with `docker compose up -d --build --pull never`. GHCR images support linux/amd64 and linux/arm64. Keep the named data volume and never use `docker compose down -v` on real data. Configure models through authenticated admin settings. Demo fixtures are explicitly fictional; live failures never silently become demo reports. Read the deployment and acceptance reports before production use.

## License

[MIT](LICENSE). Original project by 僧僧 and contributors; original license and copyright retained.
