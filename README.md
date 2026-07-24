<div align="center">
    <img width="64" alt="drawDB logo" src="./src/assets/icon-dark.png">
    <h1>drawDB Cloud</h1>
</div>

<h3 align="center">带账号云端同步与 AI(MCP)接入的自托管数据库关系图编辑器</h3>

<p align="center">
  基于开源项目 <a href="https://github.com/drawdb-io/drawdb">drawdb-io/drawdb</a> 二次开发 ·
  单账号 · 多设备同步 · Excalidraw 手绘风格 · Claude / Codex 可直接操作
</p>

---

## 项目介绍

本项目 fork 自 [**drawdb-io/drawdb**](https://github.com/drawdb-io/drawdb)(一个免费、直观的数据库关系图编辑器与 SQL 生成器)。原版把图表存在浏览器本地(IndexedDB),换设备就看不到。

本 fork 在保留原版全部编辑能力的基础上,增加了一套**面向个人的云端后端**,并做了交互与视觉改造:

- **数据存到云端**,登录同一账号的任意设备看到同一份图表;
- 新增一个轻量后端(Fastify + Postgres),前端接入 drawdb 预留的扩展点,对上游改动很小,便于后续合并官方更新;
- 提供 **MCP 服务**,让 Claude Code / Codex 等 AI 助手直接读写你的图表;
- 界面改成 **Excalidraw 手绘风格**,并补齐了画布直接编辑、移动端适配等体验。

仓库地址:<https://github.com/zhu-jiyuan/drawdb>

## 功能

**云端同步(个人版)**
- 单账号密码登录,httpOnly 会话 Cookie(30 天滑动过期),多设备共享同一份数据
- 整图快照 + 版本号乐观锁:两台设备冲突时弹窗选择,输掉的版本自动进云端修订历史(每图保留最近 30 版),任何情况不丢数据
- 离线优先:断网时保存进本地 outbox,联网自动补传;云端图表在本地留镜像,离线也能打开
- 软删除(30 天内可恢复)、一键把浏览器里的旧本地图迁移上云

**AI 接入(MCP 服务)**
- 内置 MCP 服务器,暴露 6 个工具:`list_diagrams` / `get_diagram` / `create_diagram` / `update_diagram` / `delete_diagram` / `list_revisions`
- 两种传输:**HTTP**(`https://你的域名/mcp`,无需本地安装)和 **stdio**(本地 node 进程)
- AI 用简化的“表 / 字段 / 外键”描述即可建表改表,服务器自动生成 drawdb 内部结构并按外键层级**自动排版**
- 认证用独立的 **MCP Key**(登录后在页面上自助生成 / 重新生成 / 停用),密码无需出现在任何 AI 配置里

**编辑器体验**
- Excalidraw 手绘风格:手写字体、抖动线条、紫罗兰主题(可在「视图」菜单里切回普通风格)
- **画布上直接编辑**:双击表名 / 字段名就地改,双击字段行改类型(可搜索下拉),拖表格右边缘调整宽度
- 一键自动整理布局(按外键层级排布,父表在左、子表向右,不重叠)
- 移动端适配:单指拖动平移、打开图表自动适配到屏内、深色模式全站跟随
- 继承 drawdb 原有能力:导入 / 导出 SQL、DBML、多种数据库方言(PostgreSQL / MySQL / SQLite / MariaDB / MSSQL / Oracle / Generic)、模板、自定义类型与枚举等

## 快速开始(本地开发)

```bash
# 1. 起一个 Postgres
docker run -d --name drawdb-pg -p 5432:5432 \
  -e POSTGRES_USER=drawdb -e POSTGRES_PASSWORD=drawdb -e POSTGRES_DB=drawdb \
  postgres:16-alpine

# 2. 后端 API(:3001)
cd server && npm install
DATABASE_URL=postgres://drawdb:drawdb@localhost:5432/drawdb AUTH_PASSWORD=dev node index.js

# 3. 前端(:5173,/api 已代理到 :3001)
npm install && npm run dev
```

浏览器打开 <http://localhost:5173>,用 `dev` 登录。

## 部署

镜像 `ghcr.io/zhu-jiyuan/drawdb-cloud` 由 GitHub Actions 在打 `v*` tag 时自动构建(linux/arm64)。也可以本地自行构建。

### 方式一:Docker Compose(单机自托管,最简单)

```bash
cp .env.example .env          # 编辑 .env,至少设置 AUTH_PASSWORD
docker compose -f compose.cloud.yml up -d --build
```

访问 `http://<服务器>:8080`,右下角登录,输入 `AUTH_PASSWORD`。

- 应用监听容器内 3001,compose 映射到主机 **8080**;Postgres 数据在 `pgdata` 卷里。
- 国内构建加速:`--build-arg NPM_REGISTRY=https://registry.npmmirror.com`
- **备份 / 恢复**:
  ```bash
  docker compose -f compose.cloud.yml exec db pg_dump -U drawdb drawdb > backup.sql
  cat backup.sql | docker compose -f compose.cloud.yml exec -T db psql -U drawdb drawdb
  ```

### 方式二:Kubernetes

仓库自带示例清单 [`deploy/k8s.yaml`](./deploy/k8s.yaml)(Postgres StatefulSet + 应用 Deployment / Service / Ingress):

```bash
# 1. 创建密钥(不进 git)
kubectl create secret generic drawdb-secrets \
  --from-literal=AUTH_PASSWORD='<登录密码>' \
  --from-literal=POSTGRES_PASSWORD='<数据库密码>' \
  --from-literal=MCP_KEY=''

# 2. 改 deploy/k8s.yaml 里的镜像 tag、Ingress 域名与 TLS secret,然后:
kubectl apply -f deploy/k8s.yaml
```

就绪 / 存活探针走 `/api/health`。生产环境建议把镜像 tag 固定为具体版本(如 `:v1.2.0`)而非 `latest`,配合 GitOps(Argo CD 等)按 tag 发版、回滚。

### 发版流程

打 tag → CI 构建版本镜像 → 更新部署里的镜像 tag → 滚动更新。

```bash
git tag v1.2.1 && git push origin v1.2.1
# CI 产出 ghcr.io/zhu-jiyuan/drawdb-cloud:v1.2.1
# 把 deploy/k8s.yaml(或 compose)里的镜像改到 v1.2.1 后重新 apply / up
```

## MCP:让 Claude / Codex 操作你的图表

先在网页首页点 **「MCP Key」** 生成一个 Key,然后二选一接入(详见 [`mcp/README.md`](./mcp/README.md)):

**HTTP(推荐,无需本地安装)** — Claude Code:

```bash
claude mcp add --transport http --scope user drawdb https://你的域名/mcp \
  --header "Authorization: Bearer <KEY>"
```

Codex(`~/.codex/config.toml`):

```toml
[mcp_servers.drawdb]
transport = { type = "streamable_http", url = "https://你的域名/mcp" }
bearer_token_env_var = "DRAWDB_MCP_KEY"
```

**stdio(本地进程)** — `claude mcp add drawdb --env DRAWDB_MCP_KEY=<KEY> -- node <仓库路径>/mcp/index.js`

## 配置项(环境变量)

后端(`server/`,也用于 compose / k8s):

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `AUTH_PASSWORD` | ✅ | — | 唯一的登录密码;为空则拒绝启动 |
| `DATABASE_URL` | | `postgres://drawdb:drawdb@localhost:5432/drawdb` | Postgres 连接串 |
| `MCP_KEY` | | 空 | 可选的 MCP Bearer Key(env 方式);留空则只用页面上生成的 Key |
| `PORT` / `HOST` | | `3001` / `0.0.0.0` | 监听地址 |
| `TRUST_PROXY` | | `false` | 有反向代理时设 `true`(否则可被伪造 X-Forwarded-For 绕过登录限流) |
| `COOKIE_SECURE` | | `auto` | `auto` / `true` / `false`,控制会话 Cookie 的 Secure 标记 |
| `STATIC_DIR` | | `../dist` | 前端构建产物目录;不存在则以纯 API 模式运行 |

Compose 额外读取:`POSTGRES_PASSWORD`(默认 `drawdb`)、`NPM_REGISTRY`(构建加速)。

## 安全说明

- 密码 / MCP Key 服务端只存 SHA-256 哈希;错误尝试计入按 IP + 全局的登录限流,防暴力破解
- MCP Key 只能访问图表接口,不能登录、也不能管理 Key 自身(管理接口仅认密码会话)——泄露后在页面上重新生成即失效
- 公网部署请置于 HTTPS 之后(反代终止 TLS 并设 `TRUST_PROXY=true`)

## 技术栈

前端 React + Vite + Semi UI;后端 Fastify + node-postgres;数据库 PostgreSQL 16;MCP 用 `@modelcontextprotocol/sdk`。

## 致谢与许可

本项目基于 [drawdb-io/drawdb](https://github.com/drawdb-io/drawdb) 二次开发,遵循 **AGPL-3.0** 许可(见 [`LICENSE`](./LICENSE))。感谢原作者与社区。云端后端、MCP 服务、Excalidraw 化改造等为本 fork 新增。
