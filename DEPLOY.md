# 部署指南：让其他人也能打开 AI 消保材料智能审查工具（合同类）

工具本体是「一个 Node 服务 + 静态页面」，没有第三方依赖，所以部署门槛很低。按使用场景选一条路线即可。

| 场景 | 适合 | 耗时 | 是否需要服务器/备案 |
| --- | --- | --- | --- |
| A. 局域网共享 | 同办公室的同事访问 | 5 分钟 | 不需要 |
| B. 临时公网链接 | 给外部同事临时演示 | 5 分钟 | 不需要 |
| C. 云服务器 + Docker + 域名 | 正式长期使用 | 1–2 小时 | 需要（国内域名需备案） |
| D. 托管平台（Render/Railway 等） | 不想管服务器 | 30 分钟 | 不需要 |

> 无论走哪条路，**访问密钥都只放在服务端环境变量里**，不要写进代码、页面或文档；本项目的 `.env` 已被 `.gitignore` 忽略。

---

## A. 局域网共享（最快）

1. 确认 `.env` 中 `HOST=0.0.0.0`、`PORT=8787`（默认已是）。
2. 在这台机器上启动服务：`node server.js`（或双击 `start.cmd`）。
3. 查询本机内网 IP：

   ```powershell
   ipconfig | Select-String "IPv4"
   ```

4. 放行防火墙端口（管理员 PowerShell，执行一次即可）：

   ```powershell
   New-NetFirewallRule -DisplayName "合同审查工作台 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
   ```

5. 把 `http://<你的内网IP>:8787` 发给同事（例如 `http://192.168.1.20:8787`）。

限制：只有同一内网能访问；这台机器关机后服务就停了。

---

## B. 临时公网链接（不买服务器）

用 Cloudflare Tunnel 把本机服务临时暴露成一个公网 HTTPS 地址：

1. 下载 `cloudflared`（Cloudflare 官方单文件工具）。
2. 启动服务：`node server.js`。
3. 新开一个窗口执行：

   ```bash
   cloudflared tunnel --url http://localhost:8787
   ```

4. 命令会输出一个 `https://xxxx.trycloudflare.com` 地址，把它发给别人即可（HTTPS，无需备案）。

注意：链接在命令运行期间有效，关闭即失效；**任何拿到该链接的人都能使用你的工作流额度**，因此只把它用于演示，不要长期挂着。

---

## C. 云服务器 + Docker + 域名（推荐用于正式使用）

### 1. 准备

- 一台云服务器（2 核 2G 起，Ubuntu 22.04/Debian 12 均可），需能访问 `api.coze.cn`。
- 一个域名，解析到服务器公网 IP。
- 中国大陆地区的服务器 + 域名对外提供 80/443 服务需要完成 ICP 备案；不想备案可选中国香港或新加坡节点。

### 2. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 3. 上传代码

把 `contract-review-workbench` 整个目录传到服务器，例如 `/opt/contract-review-workbench`（`.env` 不要上传到公开仓库）。

### 4. 在服务器上创建 `.env`

```bash
cd /opt/contract-review-workbench
cat > .env <<'EOF'
COZE_API_TOKEN=这里填你的扣子访问密钥
COZE_WORKFLOW_ID=7684698570696376330
COZE_API_BASE=https://api.coze.cn
PORT=8787
HOST=0.0.0.0
# 正式环境建议关闭第三方临时链接，改用扣子文件直传
ALLOW_TEMP_LINK=false
COZE_TIMEOUT_MS=180000
EOF
chmod 600 .env
```

### 5. 启动应用 + 自动 HTTPS

```bash
DOMAIN=你的域名 docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d --build
```

Caddy 会自动申请并续期证书，随后可通过 `https://你的域名` 访问。

### 6. 用 Nginx 部署（可选替代方案）

如果服务器上已有 Nginx：

```bash
docker compose up -d --build          # 应用只监听 127.0.0.1:8787
cp deploy/nginx.conf.example /etc/nginx/conf.d/contract-review-workbench.conf
# 修改其中的 server_name 为你的域名
nginx -t && systemctl reload nginx
certbot --nginx -d 你的域名           # 申请 HTTPS 证书
```

### 7. 常用运维命令

```bash
docker compose logs -f --tail=100      # 查看日志（不含访问密钥）
docker compose ps                      # 查看状态与健康检查
docker compose up -d --build           # 更新代码后重建
docker compose down                    # 停止
curl -s http://127.0.0.1:8787/healthz  # 健康检查
```

---

## D. 托管平台（Render / Railway / Fly.io 等）

把代码推到一个私有 Git 仓库，然后：

1. 平台选择 **Node 环境**，启动命令填 `node server.js`。
2. 在平台的 **环境变量 / Secrets** 里配置 `COZE_API_TOKEN`、`COZE_WORKFLOW_ID`、`COZE_API_BASE`、`PORT`（多数平台会自带 `PORT`，直接用平台的即可）、`ALLOW_TEMP_LINK=false`。
3. 健康检查路径填 `/healthz`。
4. 区域尽量选择中国香港 / 新加坡等离 `api.coze.cn` 较近的节点。
5. 直接使用 Dockerfile 部署也可以（平台会自动识别）。

注意：

- 有些无服务器平台对单次请求有 10–30 秒上限，而工作流通常需要 30–60 秒，请选择支持长请求的常驻服务（Render/Railway/Fly 的常驻实例均可）。
- 请求体上限要大于 24MB，否则上传合同会被平台拦截。
- 平台域名自带 HTTPS，无需自行申请证书；如需自定义域名按平台指引绑定。

---

## E. 上线前检查清单

- [ ] 访问密钥只存在于服务端（`.env` 或平台 Secrets），未提交到 Git，未出现在页面与文档中。
- [ ] `.env` 权限为 600，`.gitignore` 已忽略 `.env`。
- [ ] 扣子个人访问令牌已开通**工作流执行**权限；如需文件直传，再开通**文件上传**权限。
- [ ] 正式环境把 `ALLOW_TEMP_LINK` 设为 `false`，避免合同内容经由第三方临时链接中转（该开关需要配合文件上传权限）。
- [ ] 对外使用 HTTPS：剪贴板复制、浏览器安全策略与合规审计都依赖 HTTPS。
- [ ] 反向代理放宽请求体大小（示例 24MB）与读超时（示例 300 秒）。
- [ ] 明确访问范围：公网开放意味着任何拿到网址的人都会消耗你的工作流额度，建议至少加一层限制：
  - 仅内网 / VPN 访问；
  - 或 Nginx 基础认证：

    ```bash
    htpasswd -c /etc/nginx/.htpasswd legal
    # 在 server 块内加入：
    # auth_basic "合同审查工作台";
    # auth_basic_user_file /etc/nginx/.htpasswd;
    ```

- [ ] 日志轮转已配置（本项目的 compose 文件已限制日志大小）。
- [ ] 服务器时间同步正常（页面显示审查时间）。
- [ ] 已知悉页面提示的免责声明：审查结果为 AI 辅助输出，不构成正式法律意见。

---

## F. 更新与回滚

```bash
git pull                                # 或重新上传代码
docker compose up -d --build            # 重建并滚动重启
docker compose logs -f                  # 确认启动正常
```

镜像按 `image: contract-review-workbench:latest` 打标签，如需回滚可先 `docker tag` 保存当前版本，或保留上一版目录再切换。

---

## G. 通过 GitHub 部署（推荐路线）

代码托管到 GitHub 后，有两种落地方式：**平台自动部署**（最省事）或 **构建镜像 + 部署到自己的服务器**。仓库里已准备好对应的配置：

| 文件 | 作用 |
| --- | --- |
| `.github/workflows/ci.yml` | 每次推送自动做语法检查、密钥泄漏扫描、启动冒烟测试 |
| `.github/workflows/docker-publish.yml` | 构建镜像并推送到 GitHub 容器镜像仓库（ghcr.io），可选自动部署到服务器 |
| `Dockerfile` | 平台构建镜像时使用（无第三方依赖，非 root 运行，自带健康检查） |
| `render.yaml` | Render 一键部署蓝图 |
| `fly.toml` | Fly.io 配置 |
| `railway.json` | Railway 配置 |
| `scripts/check-secrets.mjs` | 本地或 CI 用的密钥扫描（`npm run check:secrets`） |

### 1. 推送到 GitHub

```bash
cd contract-review-workbench
git init -b main
git add .
git commit -m "合同审查工作台：可运行的扣子工作流前端与服务端"
# 在 GitHub 上新建一个空仓库（建议设为 Private），然后：
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

推送前建议先跑一次密钥扫描，确认 `.env` 没有被提交：

```bash
npm run check:secrets
git status --short          # .env 不应出现在待提交列表里
```

> **不要把访问密钥写进仓库。** 密钥通过平台的环境变量 / Secrets 注入，`.env` 已被 `.gitignore` 忽略。

### 2A. 平台自动部署（推荐，无需自己维护服务器）

**Render**：控制台 → New → Blueprint → 选择本仓库，仓库里的 `render.yaml` 会被自动识别；部署时在环境变量处填入 `COZE_API_TOKEN`（`sync: false` 表示不写入仓库、由你在控制台填写）。区域建议新加坡。

**Fly.io**：

```bash
fly launch --no-deploy          # 识别现有 fly.toml，不要覆盖
fly secrets set COZE_API_TOKEN=你的密钥 COZE_WORKFLOW_ID=7684698570696376330
fly deploy
```

**Railway**：New Project → Deploy from GitHub repo，仓库里的 `railway.json` 会被自动使用；在 Variables 里添加 `COZE_API_TOKEN`、`COZE_WORKFLOW_ID`、`COZE_API_BASE`。

注意：三个平台的免费/低价实例都属常驻容器，可以承载 30–60 秒的工作流请求；但**不要**选无服务器（Serverless / Functions）方案，那里单次请求通常 10–30 秒就会被平台中断。

### 2B. 构建镜像 + 部署到自己的服务器

`.github/workflows/docker-publish.yml` 会在推送到 `main` 后把镜像推送到 `ghcr.io/<你的账号>/<仓库名>:latest`。服务器上只需拉取镜像运行：

```bash
# 服务器上：把 compose 文件里的 image 改成 ghcr.io/<账号>/<仓库名>:latest
echo <GitHub 个人访问令牌> | docker login ghcr.io -u <你的账号> --password-stdin
docker compose pull && docker compose up -d
```

如果想让推送后自动部署，在仓库 Settings 里配置：

- Secrets：`SSH_HOST`、`SSH_USER`、`SSH_KEY`（部署私钥）、`SSH_PORT`（可选，默认 22）
- Variables：`ENABLE_SSH_DEPLOY=true`、`DEPLOY_PATH=/opt/contract-review-workbench`

配置完成后，`docker-publish.yml` 的 `deploy` 任务会在镜像构建成功后自动 SSH 到服务器执行 `docker compose pull && docker compose up -d`。

### 3. 关于 GitHub Pages（不可行，务必注意）

**不要用 GitHub Pages 部署本项目。** Pages 只托管静态文件，页面在浏览器里直接运行，而合同审查必须由服务端持有扣子访问密钥并调用工作流——放到 Pages 上就意味着把密钥暴露给任何打开网页的人，同时也无法处理 30–60 秒的工作流请求与文件上传。GitHub 在本项目里的正确角色是**代码托管与 CI/CD 来源**，而不是运行环境。

### 4. 用 GitHub 作为访问控制层（可选）

如果把服务放在自己的服务器上，又不想额外做登录，可以用 GitHub 的团队协作方式来控制变更：仓库设为 Private，仅授权成员能改代码与触发部署；对外访问再用 DEPLOY.md「上线前检查清单」里的内网/VPN 或 Nginx 基础认证限制。
