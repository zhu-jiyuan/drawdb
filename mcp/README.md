# drawdb-mcp

一个通过 stdio 传输运行的 **MCP（Model Context Protocol）服务器**，让 AI 助手（Claude Code、Codex CLI 等）能够管理自建 drawdb cloud 后端中的数据库关系图。

服务器在本地运行，使用单账户密码登录后端，通过其 REST API 读写关系图。所有工具都返回 JSON 文本；用户在浏览器里打开的编辑器标签页会通过 “有更新版本” 横幅感知到你所做的更改，重新加载即可看到。

## 环境变量

| 变量 | 是否必填 | 说明 |
| --- | --- | --- |
| `DRAWDB_PASSWORD` | **必填** | drawdb 部署的账户密码。缺失时进程会以退出码 1 结束，并在 stderr 打印提示。密码永远不会被打印出来。 |
| `DRAWDB_URL` | 可选 | 部署的基础 URL，默认 `https://drawdb.mpga.me`。 |

要求 Node 20+（使用全局 `fetch`、`crypto.randomUUID`、`structuredClone`）。首次运行前在 `mcp/` 目录执行一次 `npm install`。

## 安装配置

### Claude Code

```bash
claude mcp add drawdb --env DRAWDB_PASSWORD=<密码> -- node /home/peter/dev/drawsql/mcp/index.js
```

加上 `--scope user` 可将其注册为全局可用（对所有项目生效）：

```bash
claude mcp add drawdb --scope user --env DRAWDB_PASSWORD=<密码> -- node /home/peter/dev/drawsql/mcp/index.js
```

如需指向不同部署，追加 `--env DRAWDB_URL=https://你的域名`。

### Codex CLI（`~/.codex/config.toml`）

```toml
[mcp_servers.drawdb]
command = "node"
args = ["/home/peter/dev/drawsql/mcp/index.js"]
env = { DRAWDB_PASSWORD = "<密码>", DRAWDB_URL = "https://drawdb.mpga.me" }
```

## 工具列表

| 工具 | 作用 |
| --- | --- |
| `list_diagrams` | 列出账户中的所有关系图（名称、数据库方言、修改时间、大小），并附带每个关系图的编辑器 URL。 |
| `get_diagram` | 读取单个关系图的简化视图：表及其字段、外键关系，以及 notes/areas/enums/types 的数量；`include_layout` 可附带每个表的 x/y/color。 |
| `create_diagram` | 新建关系图：给定表（含字段）与可选外键关系，服务器自动生成 id 并按网格布局；返回 diagramId、URL、version。 |
| `update_diagram` | 对已有关系图做增量修改：改名、增删表、改表名、增删改字段、增删关系。采用乐观并发控制，保留未触及的所有内容（布局、notes、areas、枚举/类型等）。 |
| `delete_diagram` | 删除关系图（需 `confirm: true`）。服务端为软删除，约 30 天内可恢复。 |
| `list_revisions` | 列出关系图的历史版本（version、名称、时间、大小）。v1 不提供恢复操作，仅供参考。 |

## 简化输入结构

`create_diagram` / `update_diagram` 接受简化结构，服务器会将其规范化为完整的 drawdb 文档（自动补全 id 与布局）。

- **SimpleField**：`{ name, type, primary?, notNull?, unique?, increment?, default?, size?, values?, comment? }`
  - `type` 应匹配关系图的 SQL 方言，例如 `INT`、`BIGINT`、`VARCHAR`（配合 `size`）、`TEXT`、`TIMESTAMP`、`BOOLEAN`，会被统一转为大写。
  - `primary: true` 默认同时意味着 `notNull: true` 与 `unique: true`（除非显式设为 false）。
  - `values` 用于 `ENUM`/`SET`。
- **SimpleTable**：`{ name, comment?, fields: SimpleField[] }`
- **SimpleRel**：`{ fromTable, fromField, toTable, toField, cardinality?, onDelete?, onUpdate? }`
  - `from` 一侧是**子表 / 外键持有方**，`to` 一侧是**父表 / 被引用方**。表名/字段名会被解析为内部 id（找不到或有歧义时报错）。
  - `cardinality` 默认 `many_to_one`，可选 `one_to_one` / `one_to_many` / `many_to_one`。
  - `onDelete` / `onUpdate` 取值：`No action` / `Restrict` / `Cascade` / `Set null` / `Set default`。

## 数据库方言

`generic`（默认）、`postgresql`、`mysql`、`sqlite`、`mariadb`、`mssql`、`oraclesql`。
