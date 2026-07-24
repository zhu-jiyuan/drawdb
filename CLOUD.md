# drawDB 云端同步(个人版)

本 fork 在 [drawdb-io/drawdb](https://github.com/drawdb-io/drawdb) 基础上增加了**账号登录 + 云端存储**:
不同设备登录同一账号,看到并编辑同一份图表。为个人使用设计——单账号、无注册流程、无团队协作。

## 架构

```
┌────────────────────────── VPS / NAS ──────────────────────────┐
│  app 容器(Fastify)                    db 容器(Postgres 16) │
│   ├─ 托管前端静态文件                    └─ pgdata 卷          │
│   └─ /api/*(登录、图表 CRUD、修订历史)                       │
└───────────────────────────────────────────────────────────────┘
```

- 前端通过上游预留的 `ExtensionsContext` 扩展点接入云存储(`src/cloud/`),
  上游核心文件几乎零改动,后续合并上游更新成本低。
- 编辑器保存 = 整图快照 + 版本号乐观锁(CAS)。版本冲突时弹窗选择,输掉的
  版本自动进入云端修订历史(每图保留最近 30 版),任何情况不丢数据。
- 断网时保存进本地 outbox(IndexedDB),联网后自动补传;云端图表在本地留
  镜像,离线也能打开。
- 认证:单密码(服务端环境变量)+ httpOnly 会话 cookie(30 天滑动过期)。

## 部署

> 生产环境已迁移至 GitOps:清单在 [zhu-jiyuan/k8s-deploy](https://github.com/zhu-jiyuan/k8s-deploy)
> 的 `manifests/drawdb/`,由集群内 Argo CD 自动同步,不再使用本仓库的 compose/清单部署。
> 以下 compose 方式仅适用于单机自托管。

```bash
cp .env.example .env        # 编辑 .env,设置 AUTH_PASSWORD(登录密码)
docker compose -f compose.cloud.yml up -d --build
```

访问 `http://<服务器>:8080`,右下角「登录云端」→ 输入 `AUTH_PASSWORD`。

国内构建加速:`docker compose -f compose.cloud.yml build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`

### 备份 / 恢复

```bash
docker compose -f compose.cloud.yml exec db pg_dump -U drawdb drawdb > backup.sql
cat backup.sql | docker compose -f compose.cloud.yml exec -T db psql -U drawdb drawdb
```

## 旧数据迁移

登录后点击左下角云端徽章 →「上传本地图表」:自动先下载一份 zip 备份,再把
浏览器里的本地图表全部上传(保留原 URL)。若云端已有更新副本,以云端为准,
被跳过的本地版本保留在备份 zip 里。

## 本地开发

```bash
docker run -d --name drawdb-pg -p 5432:5432 \
  -e POSTGRES_USER=drawdb -e POSTGRES_PASSWORD=drawdb -e POSTGRES_DB=drawdb \
  postgres:16-alpine
cd server && npm install && AUTH_PASSWORD=dev node index.js   # API :3001
npm install && npm run dev                                    # 前端 :5173(/api 已代理)
```

## 改动清单(相对上游)

| 位置 | 内容 |
|---|---|
| `server/` | 新增:Fastify + pg 后端(登录、图表 CRUD、修订、清理任务) |
| `src/cloud/` | 新增:API 客户端、同步引擎(outbox/CAS/冲突)、Provider、状态徽章 |
| `src/pages/Login.jsx` | 新增:登录页 |
| `src/App.jsx` | 编辑:挂 CloudProvider + `/login` 路由 |
| `src/data/db.js` | 编辑:Dexie v68 增加 `cloudMirror` 镜像/outbox 表 |
| `vite.config.js` | 编辑:开发环境 `/api` 代理 |
| `src/i18n/locales/{en,zh}.js` | 编辑:新增 `cloud_*` 文案 |
| `Dockerfile.cloud`、`compose.cloud.yml` | 新增:生产部署 |

合并上游时留意:`Workspace.jsx` / `ControlPanel.jsx` 中 `extensions.*` 的调用契约若有变化,需同步调整 `src/cloud/sync.js` 的实现。
