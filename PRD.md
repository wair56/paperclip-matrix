# Paperclip Matrix — 产品需求文档 (PRD)

> 版本: 1.0  
> 最后更新: 2026-04-09

---

## 1. 产品愿景

**Paperclip Matrix** 是一个部署在本地工作站上的**全栈 Web 控制面板**，用于编排和监控多个自治 AI 代理（"远程员工"）。  
它将传统的命令行操作方式完全替换为图形化界面，使运营者能够通过一个浏览器页面完成：代理注册、任务分发、进程监控、环境隔离、数据备份。

**一句话定位**：本地 AI 代理大军的"人力资源中控室"。

---

## 2. 目标用户

| 用户类型 | 场景 |
|:---------|:-----|
| 自动化工作室运营者 | 在单台物理机上运行多个 AI 代理，执行代码生成、爬虫、数据分析等任务 |
| 远程团队管理者 | 将本地机器作为 Paperclip 云端公司的"外包节点"，接收和执行远程派单 |
| AI 工具链研究者 | 需要快速部署和管理多种 LLM CLI 工具 (Claude, Codex) 的沙箱环境 |

---

## 3. 核心功能模块

### 3.1 代理招聘办 (Identity Onboarding)
**目标**: 让新的 AI 代理"入职"本机，获取远端身份和 API 密钥。

| 功能项 | 说明 |
|:-------|:-----|
| Auto-Join 表单 | 填写远端 API URL、公司 ID、主密钥（Board Key），一键向云端注册并自动取回专属 API Key |
| 身份存储 | 回写为 `.data/identities/<role>.env` 格式的本地安全配置文件 |
| 花名册展示 | 主面板右侧显示所有已注册代理的角色名、Agent ID、连接服务器地址 |

**API**: `GET /api/identity` (读取身份列表), `POST /api/identity` (远端注册)

---

### 3.2 代理启停控制 (Worker Orchestration)
**目标**: 以图形化按钮控制代理进程的生命周期。

| 功能项 | 说明 |
|:-------|:-----|
| Ignite (点火) | 点击按钮，后端通过 `SandboxManager` 生成隔离环境，`spawn` 启动代理 CLI 进程 |
| Terminate (终止) | 通过 PID 直接 `process.kill()` 杀死对应进程 |
| 沙箱隔离 | 每个代理启动时只获得白名单过滤后的环境变量，`HOME` 被伪造为工作目录，无法访问宿主真实配置 |

**API**: `POST /api/worker` (启动), `DELETE /api/worker` (终止)

---

### 3.3 系统资源雷达 (System Telemetry)
**目标**: 实时展示宿主机 CPU 和内存使用状态，防止模型失控耗尽系统资源。

| 功能项 | 说明 |
|:-------|:-----|
| CPU 占用率 | 基于 `os.cpus()` idle-time 差值计算真实占比（非 loadavg 近似值） |
| 内存使用率 | macOS 上使用 `vm_stat` 获取含可回收内存的真实可用量 |
| 前端展示 | 顶部进度条 + 数字，每 3 秒自动刷新 |

**API**: `GET /api/sysinfo`

---

### 3.4 沙盒快照备份 (Sandbox Backup)
**目标**: 一键将指定代理的工作目录压缩归档。

| 功能项 | 说明 |
|:-------|:-----|
| 压缩打包 | 调用系统原生 `tar -czf` 将 `.data/workspaces/<role>` 打包 |
| 自动排除 | 跳过 `node_modules`、`.git`、`.DS_Store` |
| 归档存储 | 存放于 `.data/archives/` 目录 |

**API**: `POST /api/backup`

---

### 3.5 指纹浏览器集成 (Antidetect Browser Bridge) — 规划中
**目标**: 为需要网页操作的代理绑定专属浏览器指纹环境。

| 功能项 | 说明 |
|:-------|:-----|
| Profile 绑定 | 在招聘界面为代理指定指纹浏览器 Profile ID |
| WS 端口注入 | 启动代理时自动从本地指纹浏览器 API 获取 WebSocket 调试端口并注入 `BROWSER_WS_ENDPOINT` |
| 画中画监工 | 由于浏览器窗口在本机原生打开，运营者可直接视觉观察代理操作 |

---

## 4. 技术架构

```
┌──────────────────────────────────────────────┐
│           Next.js Full-Stack App             │
│                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │ page.js │  │ API Routes│  │SandboxMgr  │  │
│  │ (React) │──│ /api/*    │──│ (进程隔离) │  │
│  └─────────┘  └──────────┘  └────────────┘  │
│       │             │              │         │
│       ▼             ▼              ▼         │
│   Browser        .data/       spawn(claude)  │
│   (localhost:    identities/   with isolated  │
│    3000)        workspaces/    env + cwd      │
└──────────────────────────────────────────────┘
```

### 技术栈
| 层级 | 技术 |
|:-----|:-----|
| 框架 | Next.js 16 (App Router) |
| 运行时 | Bun |
| 样式 | Vanilla CSS (Lovable 暖夜风) |
| 前端 | React 19 (Client Components) |
| 后端 | Next.js API Routes (Server-side Node.js) |
| 进程管理 | Node `child_process.spawn` + 白名单 env 注入 |

---

## 5. 数据目录结构

```
paperclip-dashboard/
├── .data/                    # 所有运行时数据（已 gitignore）
│   ├── identities/           # 代理身份配置 (.env 文件)
│   ├── workspaces/           # 代理沙盒工作目录
│   └── archives/             # 压缩备份存档
├── src/
│   ├── app/                  # 页面和 API 路由
│   └── lib/                  # 业务逻辑模块
├── DESIGN.md                 # 设计系统规范
├── PRD.md                    # 本文档
└── package.json
```

---

## 6. 安全模型

| 防线 | 机制 |
|:-----|:-----|
| 环境变量隔离 | `spawn` 时传入纯净的 `env` 字典，剥离宿主所有敏感变量 |
| HOME 目录伪造 | 将 `HOME` / `USERPROFILE` 指向沙箱目录，防止模型读写真实用户配置 |
| 工作目录锚定 | `cwd` 固定为 `.data/workspaces/<role>`，模型只能在此范围内读写 |
| 跨代理隔离 | 每个代理的 `spawn` 调用携带独立的 env 字典，互不可见 |

---

## 7. 跨平台支持

| 平台 | 支持状态 | 备注 |
|:-----|:---------|:-----|
| macOS | ✅ 完全支持 | 主开发平台，`vm_stat` 提供精确内存数据 |
| Windows | ✅ 可支持 | `path.join` 处理路径分隔符，`USERPROFILE` 已纳入 env 注入 |
| Linux | ✅ 可支持 | Node.js 原生 API 跨平台兼容 |

---

## 8. 未来路线图

| 阶段 | 功能 |
|:-----|:-----|
| v1.1 | 指纹浏览器完整集成（AdsPower / HubStudio API 对接） |
| v1.2 | 代理日志实时流式输出（WebSocket 推送到前端面板） |
| v1.3 | 多机联网编排（跨局域网的面板联邦） |
| v2.0 | AI 自主任务拆解引擎（代理自行从远端领取并分解任务） |
