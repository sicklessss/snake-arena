# Snake Arena — 项目架构与代码审查报告

> 生成日期: 2026-02-21
> 目的: 为下一个开发会话提供完整上下文，包含架构说明、当前状态、已知问题和修复建议

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [项目结构](#3-项目结构)
4. [分支与构建流程](#4-分支与构建流程)
5. [服务器架构 (server.js)](#5-服务器架构-serverjs)
6. [前端架构 (src/App.tsx)](#6-前端架构-srcapptsx)
7. [智能合约](#7-智能合约)
8. [部署与运维](#8-部署与运维)
9. [合约地址清单](#9-合约地址清单)
10. [严重问题 (CRITICAL)](#10-严重问题-critical)
11. [高危问题 (HIGH)](#11-高危问题-high)
12. [中危问题 (MEDIUM)](#12-中危问题-medium)
13. [低危问题 (LOW)](#13-低危问题-low)
14. [修复优先级建议](#14-修复优先级建议)

---

## 1. 项目概述

Snake Arena 是一个实时多人贪吃蛇竞技平台：
- 玩家上传 AI Bot 代码（JavaScript），Bot 在服务端沙箱中运行，通过 WebSocket 与游戏服务器通信控制蛇的移动
- 两种竞技场：**Performance**（练习赛，最多10个房间x10蛇）和 **Competitive**（正式赛，1个房间x10蛇，有障碍物系统）
- 链上系统（Base Sepolia）：Bot NFT 铸造、注册付费、USDC 下注（Pari-Mutuel）、推荐奖励
- 积分系统：点数下注、推荐积分、排行榜
- 比赛每3分钟一局，倒计时5秒 → 开始 → 结算 → 循环

---

## 2. 技术栈

### 后端 (master 分支)
- **Runtime**: Node.js
- **Framework**: Express.js + ws (WebSocket)
- **Blockchain**: ethers.js v6
- **沙箱**: Node.js Worker Threads + vm 模块（**不安全**，见问题清单）
- **进程管理**: PM2
- **数据存储**: JSON 文件（`data/bots.json`, `data/points.json`, `data/referrals.json`, `history.json`, `match_counters.json`）

### 前端 (snake-arena-next 分支)
- **Framework**: React 19 + TypeScript
- **构建工具**: Vite 7
- **钱包连接**: RainbowKit v2 + wagmi v2 + viem
- **链**: Base Sepolia (chainId: 84532)
- **渲染**: Canvas 2D (30x30 网格)
- **依赖**: `@rainbow-me/rainbowkit@^2.2.10`, `@tanstack/react-query@^5.90.20`, `react@^19.2.0`, `viem@^2.45.3`, `wagmi@^2.19.5`

### 智能合约 (Solidity, Hardhat)
- BotRegistry.sol — Bot 注册/买卖
- SnakeBotNFT.sol — ERC721 Bot NFT
- SnakeArenaPariMutuel.sol — USDC 下注
- RewardDistributor.sol — 奖励发放
- ReferralRewards.sol — 推荐奖励

---

## 3. 项目结构

```
snake-arena/
├── server.js              # 主服务器（3482行，单文件）- 游戏逻辑、API、WebSocket、区块链
├── sandbox-worker.js       # Bot 代码沙箱执行器（Worker Thread, 175行）
├── ecosystem.config.js     # PM2 配置（5个实例，端口 3000-3004）
├── package.json            # 后端依赖 (express, ws, ethers, pm2)
├── .env                    # 环境变量（合约地址、Admin Key 等）
├── .gitignore              # Git 忽略规则
│
├── src/                    # ⚠️ 早期未完成的重构尝试（未使用）
│   ├── server.js           # 重构版服务器（未使用，主服务器在根目录）
│   ├── config/constants.js # 旧合约地址（未使用）
│   ├── routes/             # 拆分的路由（未使用）
│   ├── services/           # 拆分的服务（未使用）
│   └── ...
│
├── contracts/              # Solidity 合约源码
│   ├── BotRegistry.sol
│   ├── SnakeBotNFT.sol
│   ├── SnakeArenaPariMutuel.sol
│   ├── RewardDistributor.sol
│   └── ReferralRewards.sol
│
├── public/                 # 静态文件（前端构建产物从 snake-arena-next 复制过来）
│   ├── index.html
│   └── assets/
│
├── bots/                   # Bot 脚本文件 (bot_xxxxx.js, gitignored)
├── data/                   # 运行时数据 (gitignored)
│   ├── bots.json           # Bot 注册表
│   ├── points.json         # 积分数据
│   ├── referrals.json      # 推荐关系
│   └── entry-fee.json      # 入场费状态
├── history.json            # 比赛历史 (gitignored)
├── match_counters.json     # 比赛计数器持久化
├── replays/                # 比赛回放 JSON (gitignored)
│
├── abis/                   # 合约 ABI JSON
├── deployment.json         # 旧版部署信息（v1 Betting 合约，已弃用）
├── deployment-v2.json      # v2 部署信息
├── deployment-v3.json      # v3 部署信息
│
├── deploy-*.js/cjs/mjs     # 各版本部署脚本（⚠️ 部分含私钥！）
├── authorize-oracle.cjs    # Oracle 授权脚本（⚠️ 含私钥！）
│
├── hardhat.config.js       # Hardhat 配置
├── hardhat.config.cjs      # Hardhat CJS 配置
│
├── test/                   # 测试套件
│   ├── runner.js
│   ├── api.test.js
│   ├── blockchain.test.js
│   └── websocket.test.js
│
├── hero-agent.js           # Hero Agent 客户端
├── agent.js                # Agent 客户端
├── bot.js                  # Bot 客户端
├── ws-agent.js             # WebSocket Agent
└── launch-bots.js          # 批量启动 Bot
```

### 重要说明

1. **`src/` 目录是废弃的重构尝试**：根目录的 `src/` 包含一个未完成的模块化重构，**当前不被使用**。`package.json` 的 `main` 指向 `src/server.js`，但 PM2 和实际部署都使用根目录的 `server.js`。
2. **前端源码在 `snake-arena-next` 分支**，不在 master 分支。master 的 `public/` 目录包含的是从 snake-arena-next 构建后复制过来的产物。

---

## 4. 分支与构建流程

### 分支

| 分支 | 用途 | 关键文件 |
|------|------|----------|
| `master` | 服务器 + 静态前端 + 合约 | `server.js`, `public/`, `contracts/` |
| `snake-arena-next` | 前端源码 (React/Vite/TS) | `src/App.tsx`, `src/contracts.ts`, `src/index.css`, `src/assets/food.svg` |

### 构建部署流程

```bash
# 1. 在 snake-arena-next 分支构建前端
git checkout snake-arena-next
npm run build   # tsc -b && vite build → 产物在 dist/

# 2. 切回 master，复制构建产物
git checkout master
# 将 dist/ 内容复制到 public/（index.html + assets/）

# 3. 提交推送
git add public/ server.js
git commit -m "build: update frontend + server"
git push

# 4. SSH 部署到 VPS
ssh -p 2232 -i ~/.ssh/id_ed25519 root@107.174.228.72
cd /root/snake-arena && git pull && pm2 restart snake-server --update-env
```

---

## 5. 服务器架构 (server.js)

`server.js` 是一个 3482 行的单文件，包含以下模块（按行号区间）：

### 5.1 区块链集成 (L1-154)
- 合约地址和 ABI 定义（L14-95）
- `initContracts()` 初始化 ethers 合约实例（L104-154）
- 轮询 `BotRegistered` 事件（每30秒，L115-150）
- 需要 `BACKEND_PRIVATE_KEY` 环境变量来创建签名钱包（L25-27）
- 交易队列 `enqueueTx()` 防止 nonce 冲突（L458-493），所有链上交易串行执行

### 5.2 数据系统 (L156-448)
- 日志系统：4级日志 + `log.important()` 总是输出（L156-165）
- 沙箱管理：Worker Thread 管理，最大300个（L167-643）
- 推荐系统：两级推荐积分（L174-306）
- 积分系统：JSON 存储（L201-223）
- 比赛计数器：持久化到 `match_counters.json`，每天 UTC 重置（L414-448）
- Epoch 计算：从 2026-02-20 起算天数（L434-440）

### 5.3 Bot 沙箱管理 (L552-687)
- `startBotWorker(botId)` — 创建 Worker Thread 运行用户 Bot 脚本
- `stopBotWorker(botId)` — 终止 Worker
- 静态扫描：禁止 `require(`, `import `, `child_process`, `__dirname`, `__filename`
- 脚本保存到 `bots/` 目录
- 服务器重启时自动恢复 `running: true` 的 Bot（L660-672）

### 5.4 GameRoom 类 (L704-1718)

**游戏状态机**: `COUNTDOWN(5s) → PLAYING(180s) → GAMEOVER(5s) → COUNTDOWN`

**每帧 tick() 执行流程** (125ms/帧, 8fps):
1. 胜利暂停检查
2. 竞技场障碍物系统更新（每80帧生成新障碍物）
3. NPC 自动移动（flood-fill AI 评分各方向）
4. 补充食物至 MAX_FOOD=5
5. 移动所有存活蛇（方向 → 新头 → 吃食物/缩尾）
6. 碰撞检测（墙壁 → 自身 → 尸体 → 障碍物 → 蛇间）
7. 蛇间碰撞：长蛇吃短蛇（head-on），长蛇咬断短蛇尾部
8. 存活检查：仅剩1人 → 胜利暂停 → GAMEOVER

**比赛结算** (L1275-1347):
- 排名：存活者=1st，最后死亡的=2nd/3rd
- 积分系统 Pari-Mutuel 结算：赢家按投注比例分配总积分池
- 链上结算：`pariMutuelContract.settleMatch()`

**竞技场特性**:
- 障碍物生成：BFS 扩展，1-12格不规则形状
- 闪烁警告：16帧（2秒）闪烁后变为实体
- 死蛇变障碍物：非被吃的死蛇，身体每节变为实体障碍物

### 5.5 房间管理 (L1720-2069)
- Performance 房间：最多10个，每个10人，用 Normal Bot 填充空位
- Competitive 房间：固定1个，每2秒自动用 Agent Bot 替换 Normal Bot
- 入场费系统：从 0.01 ETH 起，所有60个 slot 填满后 +0.01
- 高价 Agent 可踢低价 Agent（outbid 机制）

### 5.6 WebSocket 处理 (L2071-2162)
- 连接时根据 URL 参数 `?arenaId=xxx` 分配房间
- 消息类型：`join`（加入游戏）、`move`（改变方向）
- 消息频率限制：20条/秒
- 断线处理：击杀玩家并清理

**WebSocket 消息协议**:
```
客户端→服务器:
  { type: "join", name: "BotName", botId: "bot_xxx" }
  { type: "move", direction: { x: 1, y: 0 } }

服务器→客户端:
  { type: "init", id: "abc12", botId: "bot_xxx", gridSize: 30 }
  { type: "queued", id: "abc12", entryPrice: 0.01 }
  { type: "update", state: { matchId, players, food, obstacles, ... } }
  { type: "match_start", matchId: 100 }
  { type: "match_end", matchId: 100, winnerName: "...", placements: [...] }
```

### 5.7 API 端点汇总

#### Bot 管理
| 端点 | 方法 | 认证 | 功能 |
|------|------|------|------|
| `/api/bot/register` | POST | rate limit 10/min | 注册新 Bot 或用 regCode 认领 |
| `/api/bot/upload` | POST | edit-token（更新已有 Bot 时需要） | 上传 Bot 代码 |
| `/api/bot/edit-token` | POST | 签名+NFT验证 | 获取编辑令牌（24h有效） |
| `/api/bot/start` | POST | Admin Key | 启动 Bot Worker |
| `/api/bot/stop` | POST | Admin Key | 停止 Bot Worker |
| `/api/bot/:botId` | GET | 无 | 获取 Bot 信息 |
| `/api/bot/my-bots` | GET | 无 | 按 owner 查找 Bot（返回数组） |
| `/api/bot/claim` | POST | 签名验证 | 认领 Bot 所有权 |

#### 用户 & 链上查询
| `/api/user/onchain-bots?wallet=` | GET | 无 | 合并本地+NFT合约查询 |
| `/api/user/bots?address=` | GET | 无 | 本地 Bot 列表 |
| `/api/bot/onchain/:botId` | GET | 无 | 链上 Bot 信息 |
| `/api/bot/nft/:botId` | GET | 无 | NFT 信息 |
| `/api/marketplace/listings` | GET | 无 | 市场列表 |

#### 竞技场
| `/api/arena/status` | GET | 无 | 所有房间状态 |
| `/api/competitive/status` | GET | 无 | 竞技场状态（含 epoch, displayMatchId） |
| `/api/competitive/enter` | POST | 无 | 付费进入竞技场 |
| `/api/match/by-display-id?id=` | GET | 无 | 显示ID → 全局ID |

#### 下注 & 积分
| `/api/bet/place` | POST | 无 | 下注（积分） |
| `/api/bet/pool?matchId=` | GET | 无 | 查询投注池 |
| `/api/points/my?address=` | GET | 无 | 查积分 |
| `/api/points/leaderboard` | GET | 无 | 积分排行榜 |

#### 推荐系统
| `/api/referral/record` | POST | 交易验证 | 记录推荐关系 |
| `/api/referral/my-stats` | POST | 签名验证 | 推荐统计 |

#### 管理
| `/api/admin/*` | 多种 | Admin Key | 管理接口 |

---

## 6. 前端架构 (src/App.tsx)

1005行的单文件 React 应用（在 `snake-arena-next` 分支），主要组件：

### 6.1 配置 (L1-22)
- RainbowKit + wagmi 配置
- Base Sepolia 链
- **WalletConnect projectId 是假的** (`'7e5c5e3e3f5e5c5e3f5e5c5e3f5e5c5e'`)

### 6.2 BotManagement 组件 (~L79-257)
- 从 `/api/user/onchain-bots?wallet=ADDRESS` 获取用户所有 Bot
- 注册新 Bot：`/api/bot/register` + 链上 `registerBot()`
- 每个 Bot 有 Edit 和 Sell 按钮
- 无 slot 数量限制，可滚动列表

### 6.3 Prediction 组件 (~L260-349)
- 显示当前比赛："Epoch X #Pbb" 格式
- 输入只接受 Pxx/Axx 格式（显示 ID）
- 快捷下注按钮：1, 5, 10 USDC
- USDC approve → placeBet 两步流程（中间用 setTimeout(3000) 等待，有 bug）
- 通过 `/api/match/by-display-id` 解析显示 ID → 全局 matchId

### 6.4 CompetitiveEnter 组件 (~L380-410)
- 付费进入竞技场
- **bug**: 调用了 `registerBot` 而不是 arena entry 函数

### 6.5 GameCanvas 组件 (~L420-650)
- Canvas 2D 渲染 30x30 网格
- WebSocket 连接获取实时游戏状态
- 食物用龙虾 SVG 渲染（`src/assets/food.svg`）
- 蛇身渲染带荧光效果 + 阴影
- 无自动重连逻辑

### 6.6 App 主组件 (~L650-1005)
- 两个标签页：Performance / Competitive
- 房间选择器（1-6，disabled 按钮）
- 排行榜、积分面板、Marketplace

### 关键文件: `src/contracts.ts`
- 导出合约地址和 ABI
- **PariMutuel 地址与 server.js 不一致**（C2 问题）

---

## 7. 智能合约

### BotRegistry.sol
- `createBot(botId, name, creator)` — 后端调用，创建 Bot 记录
- `registerBot(botId, inviter)` — 用户付费注册（铸造 NFT），每人最多5个
- `listForSale(botId, price)` / `buyBot(botId)` — 市场交易（2.5%手续费）
- 注册费通过 `registrationFee()` 查询

### SnakeBotNFT.sol (ERC721 Enumerable)
- `mintBotNFT()` — 在 registerBot 时由 BotRegistry 调用
- `getBotsByOwner(address)` — 查询地址拥有的所有 Bot ID
- 链上元数据 `tokenURI()` → base64 JSON

### SnakeArenaPariMutuel.sol (USDC 下注)
- `createMatch(matchId, startTime)` — Oracle 创建比赛
- `placeBet(matchId, botId, amount)` — 用户下注 USDC（需先 approve）
- `settleMatch(matchId, winners[])` — Oracle 结算（10%平台费，90%给投注者按名次分配：1st 50%, 2nd 30%, 3rd 20%）
- `claimWinnings(matchId)` — 投注者领取奖金
- `authorizeOracle(address)` — 授权 Oracle

### RewardDistributor.sol
- `accumulateReward(botId, amount)` — 累积奖励（由 PariMutuel 调用）
- `claimRewards(botId)` — Bot 拥有者领取（≥ MIN_CLAIM_THRESHOLD）

### ReferralRewards.sol
- EIP-712 签名验证的推荐奖励（已弃用，改为积分系统）

---

## 8. 部署与运维

### VPS 信息
- **IP**: `107.174.228.72`
- **SSH 端口**: `2232`（不是默认22）
- **SSH 命令**: `ssh -p 2232 -i ~/.ssh/id_ed25519 root@107.174.228.72`
- **注意**: Surge 代理会拦截 SSH 连接。需要对此 IP 设置直连规则。

### PM2 配置
```javascript
// ecosystem.config.js — 定义了5个实例，端口 3000-3004
// 实际通常只运行1个：pm2 restart snake-server --update-env
```

### 完整部署步骤
```bash
# 1. 本地前端构建（如有前端改动）
git checkout snake-arena-next
npm run build
git checkout master
cp -r <dist产物> public/

# 2. 推送到 GitHub
git add public/ server.js
git commit -m "build: update"
git push

# 3. VPS 部署
ssh -p 2232 -i ~/.ssh/id_ed25519 root@107.174.228.72
cd /root/snake-arena && git pull && pm2 restart snake-server --update-env
```

---

## 9. 合约地址清单

### 当前使用的地址 (server.js 硬编码默认值，v5.1)

| 合约 | 地址 |
|------|------|
| BotRegistry | `0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800` |
| RewardDistributor | `0xB354e3062b493466da0c1898Ede5aabF56279046` |
| PariMutuel | `0x1fDDd7CC864F85B20F1EF27221B5DD6C5Ffe413d` |
| SnakeBotNFT | `0xF269b84543041EA350921E3e3A2Da0B14B85453C` |
| ReferralRewards | `0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F` |

### 前端地址 (src/contracts.ts, snake-arena-next 分支)

| 合约 | 地址 | 与后端一致? |
|------|------|:---:|
| BotRegistry | `0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800` | ✅ |
| RewardDistributor | `0xB354e3062b493466da0c1898Ede5aabF56279046` | ✅ |
| **PariMutuel** | `0x9504BCA692bdD1Aff6f672F8565b2eBc2A94aFd3` | ❌ |
| SnakeBotNFT | `0xF269b84543041EA350921E3e3A2Da0B14B85453C` | ✅ |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | — |

### .env 文件中的地址（旧版 v4，当 server.js 使用环境变量覆盖时会用到）

| 变量 | 地址 |
|------|------|
| BOT_REGISTRY_CONTRACT | `0xB1D0a2C155afaa35b5eBA7aABd38c38A05D5fdD4` |
| PARIMUTUEL_CONTRACT | `0x0c1C737150a22112fE2be7dB2D46001A9f83F95f` |
| NFT_CONTRACT | `0x1f73351052d763579EDac143890E903ff0984aa3` |

**⚠️ 三个地方有不同的合约地址！必须统一。** 建议：要么更新 `.env` 为最新地址，要么从 server.js 移除默认值全靠 `.env`。

---

## 10. 严重问题 (CRITICAL)

### C1: 私钥硬编码在代码库中

**文件**: `authorize-oracle.cjs:5`, 多个 `deploy-*.js` 文件, git 历史

```javascript
// authorize-oracle.cjs
const PRIVATE_KEY = '0x22a94051b4fdd46d...';
```

**风险**: 任何人看到此仓库都能获取 Oracle 权限钱包的私钥。可以结算比赛（决定赢家）、创建/取消比赛、提取合约中的 USDC。

**修复**:
1. 立即生成新钱包，转移所有资产
2. 在合约上 `authorizeOracle(新地址)` 并撤销旧地址
3. 将私钥移至 `.env`，确保 `.env` 在 `.gitignore` 中
4. 用 `git filter-repo` 从 git 历史中清除私钥
5. 将 `authorize-oracle.cjs` 和所有 `deploy-*.js` 加入 `.gitignore`

---

### C2: PariMutuel 合约地址前后端不一致

**文件**: `src/contracts.ts:4` (snake-arena-next) vs `server.js:18` (master)

| 位置 | 地址 |
|------|------|
| 前端 | `0x9504BCA692bdD1Aff6f672F8565b2eBc2A94aFd3` |
| 后端 | `0x1fDDd7CC864F85B20F1EF27221B5DD6C5Ffe413d` |

**后果**: 用户在前端 approve USDC 给合约A，但服务器在合约B上创建比赛。下注交易会 revert 或资金进入错误合约。

**修复**: 确认哪个是最新部署的 PariMutuel 合约，统一两处地址，重新构建前端。

---

### C3: WalletConnect ProjectId 是假的

**文件**: `src/App.tsx:17` (snake-arena-next)

```typescript
projectId: '7e5c5e3e3f5e5c5e3f5e5c5e3f5e5c5e', // 明显伪造的重复模式
```

**后果**: 手机钱包（MetaMask Mobile, Rainbow 等）通过 WalletConnect 连接会静默失败。

**修复**: 在 https://cloud.walletconnect.com 注册获取真实 projectId，通过 Vite 环境变量注入。

---

### C4: VM 沙箱可逃逸

**文件**: `sandbox-worker.js`

使用 Node.js `vm` 模块执行用户上传的代码。Node.js 官方文档明确说 `vm` 不提供安全隔离。

```javascript
// 攻击示例 1：通过 setTimeout 的 constructor 链逃逸
const proc = setTimeout.constructor('return process')();
proc.mainModule.require('child_process').execSync('rm -rf /');

// 攻击示例 2：通过暴露的 Buffer
const buffer = Buffer.allocUnsafe(1000); // 可能包含敏感内存数据
```

虽然 `Function` 和 `eval` 被覆盖，但 `setTimeout` 暴露了真实的全局 `Function` 构造函数。`Buffer` 也直接暴露。

**修复建议**（按安全级别排序）:
- 最佳: Docker 容器隔离每个 Bot
- 次佳: `isolated-vm` 包（V8 隔离环境）
- 最低: 移除 `Buffer` 暴露，替换 `setTimeout/setInterval` 为自定义包装

---

## 11. 高危问题 (HIGH)

### H1: `requireSignatureAuth` 缺少 `await`

**文件**: `server.js:3325-3346`

```javascript
function requireSignatureAuth(req, res, next) {
    // ...
    // verifyWalletSignature 是 async 函数，返回 Promise
    if (!verifyWalletSignature(address, message, signature)) {
        // !Promise 永远是 false，永远不会执行到这里
        return res.status(401).json({ error: 'auth_invalid' });
    }
    req.authenticatedAddress = address.toLowerCase();
    next(); // 所有请求都会通过
}
```

**后果**: 推荐系统的签名验证完全失效，任何人可以伪造签名查看其他人的推荐统计。

**修复**:
```javascript
async function requireSignatureAuth(req, res, next) {
    // ...
    const isValid = await verifyWalletSignature(address, message, signature);
    if (!isValid) {
        return res.status(401).json({ error: 'auth_invalid' });
    }
    req.authenticatedAddress = address.toLowerCase();
    next();
}
```

---

### H2: Bot 上传端点缺少认证（新 Bot）

**文件**: `server.js:2648`

`POST /api/bot/upload` 在创建新 Bot（无 `botId` 参数）时不需要任何认证。有 rate limit (10/min) 但仍然：
- 任何人可以上传恶意 Bot 代码
- 占用服务器 Worker 资源（最多300个）
- 通过沙箱逃逸攻击服务器（见 C4）

更新已有 Bot 需要 `x-edit-token`（NFT 验证），但创建新 Bot 完全开放。

**修复**: 新 Bot 上传也要求签名认证或至少 API Key。

---

### H3: Admin Key 未设置时跳过认证

**文件**: `server.js:368-373`

```javascript
function requireAdminKey(req, res, next) {
    if (!ADMIN_KEY) return next(); // ← 没有 ADMIN_KEY 则跳过认证!
    // ...
}
```

如果 `.env` 中没有设置 `ADMIN_KEY`（或环境变量丢失），所有管理员接口变为完全开放。包括：启动/停止 Bot、踢人、重置排行榜等。

**修复**: 如果 `ADMIN_KEY` 未设置，拒绝所有请求而非放行。

---

### H4: WebSocket 无自动重连

**文件**: `src/App.tsx:476-486` (snake-arena-next)

WebSocket 断线后只显示 "Disconnected..."，不会重连。用户必须手动刷新页面。

**修复**: 在 `onclose` 中添加指数退避重连。

---

### H5: WebSocket 消息 JSON.parse 无 try/catch

**文件**: `src/App.tsx:483`

如果服务器发送格式错误的消息，`JSON.parse` 抛异常，整个 onmessage 处理器崩溃。

---

### H6: USDC Approve 使用 setTimeout(3000) 等待确认

**文件**: `src/App.tsx:306`

Approve 交易后硬编码等3秒，不够的话 placeBet 会 revert。应使用 `waitForTransactionReceipt`。

---

### H7: CompetitiveEnter 调用错误的合约函数

**文件**: `src/App.tsx:395-401`

调用 `registerBot`（注册 Bot）而不是 arena entry 函数。

---

### H8: 硬编码服务器 IP 暴露给前端

**文件**: `src/App.tsx:90`

```typescript
const guideText = 'read http://107.174.228.72:3000/SNAKE_GUIDE.md';
```

暴露裸 IP 地址，绕过任何 CDN/DDoS 保护。应改为相对路径 `/SNAKE_GUIDE.md`。

---

### H9: `/api/bet/place` 无鉴权

**文件**: `server.js:2920+`

下注 API 不验证 `bettor` 字段的真实性，任何人可以伪造其他人的下注记录，影响积分系统结算。

---

## 12. 中危问题 (MEDIUM)

| # | 文件:行号 | 问题 | 修复建议 |
|---|-----------|------|----------|
| M1 | `App.tsx:261` | `matchId` prop 类型声明但未解构使用 | 从类型和父组件传递处清除 |
| M2 | `App.tsx:976` | `players.sort()` 直接修改 state | 改为 `[...players].sort()` |
| M3 | `App.tsx:849-856` | 节流 setPlayers 无 trailing update | 添加 trailing timeout |
| M4 | `App.tsx` 多处 | 5+ 个空 `catch {}` 块 | 至少 `catch(e) { console.error(e) }` |
| M5 | `App.tsx:294-303` | 每次下注都 approve 精确金额 | 先查 allowance，不足才 approve |
| M6 | `App.tsx:131-165` | Bot 名称无输入验证 | 限制长度、字符集 |
| M7 | `server.js:520` | matchHistory 无限增长 | 设置上限或定期清理 |
| M8 | `server.js:2920` | betPools/betRecords 内存无限增长 | 结算后清理，加 TTL |
| M9 | 多文件 | 三套合约地址 (contracts.ts / server.js / .env / constants.js) | 统一为一个来源 |
| M10 | `server.js:498` | `writeFileSync` 阻塞事件循环 | 改用异步写入 |

---

## 13. 低危问题 (LOW)

| # | 位置 | 问题 |
|---|------|------|
| L1 | `App.tsx` 全局 | 20+ 处使用 `any` 类型 |
| L2 | `App.tsx` 全局 | 内联样式过多，应抽取为 CSS |
| L3 | `App.tsx:546-641` | Canvas 阴影效果每帧重复设置，性能问题 |
| L4 | `App.tsx:657-664` | 房间选择器硬编码6个按钮 |
| L5 | `App.tsx:103` | `document.execCommand('copy')` 已弃用 |
| L6 | `App.tsx:825` | Marketplace Buy 按钮无 onClick |
| L7 | `contracts.ts` | `REWARD_DISTRIBUTOR_ABI` 导出但未使用 |
| L8 | `server.js:2681` | 静态扫描可被字符串拼接绕过 |
| L9 | `server.js:327` | `colorIndex` 是全局变量，所有房间共享 |
| L10 | `server.js:714` | `setInterval` 无引用，房间销毁时无法清除 |
| L11 | `server.js:3482` | 3482行单文件，建议模块化拆分 |

---

## 14. 修复优先级建议

### 第一批（安全紧急）— 立即处理
1. **C1**: 轮换私钥，从 git 历史清除
2. **H1**: `requireSignatureAuth` 加 `await`
3. **H3**: Admin Key 缺失时拒绝而非放行
4. **H9**: `/api/bet/place` 添加鉴权

### 第二批（功能修复）— 尽快处理
5. **C2**: 统一 PariMutuel 合约地址
6. **C3**: 注册真实 WalletConnect ProjectId
7. **H6**: Approve 等待改为 `waitForTransactionReceipt`
8. **H7**: CompetitiveEnter 修复合约函数调用
9. **H8**: 移除硬编码 IP，改为相对路径

### 第三批（稳定性）
10. **H4**: WebSocket 自动重连
11. **H5**: JSON.parse 加 try/catch
12. **H2**: Bot 上传增加认证
13. **M2**: Array.sort 不修改 state
14. **M4**: 空 catch 块加日志

### 第四批（安全加固）
15. **C4**: 替换 vm 沙箱为 isolated-vm 或 Docker
16. **L8**: 增强静态扫描

### 第五批（代码质量）
17. **M1/M9**: 清理未使用的 prop，统一合约地址来源
18. **M7/M8**: 数据增长控制
19. **L11**: 考虑模块化拆分 server.js

---

## 附录：关键常量

```
MATCH_DURATION = 180 秒 (3分钟)
MAX_FOOD = 5
DEATH_BLINK_TURNS = 24
GRID_SIZE = 30 (CONFIG.gridSize)
MAX_WORKERS = 300
ROOM_MAX_PLAYERS = { performance: 10, competitive: 10 }
ROOM_LIMITS = { performance: 10, competitive: 2 }
BOT_CREDITS_INITIAL = 20
REFERRAL_POINTS_L1 = 100
REFERRAL_POINTS_L2 = 50
EPOCH_ORIGIN = 2026-02-20T00:00:00Z
ADMIN_KEY = 'snake-admin-key-2024' (from .env)
BOT_UPLOAD_KEY = 同 ADMIN_KEY (from .env)
TICK_INTERVAL = 125ms (8fps)
COUNTDOWN_SECONDS = 5
GAMEOVER_SECONDS = 5
OBSTACLE_SPAWN_INTERVAL = 80 ticks (10秒)
OBSTACLE_BLINK_DURATION = 16 ticks (2秒)
```

## 附录：Bot 注册表结构 (data/bots.json)

```javascript
{
    "bot_abc123": {
        "id": "bot_abc123",
        "name": "MyBot",
        "owner": "0x1234...",           // 钱包地址
        "price": 0,
        "botType": "agent",             // agent | hero | normal
        "credits": 20,                  // 免费试玩次数（unlimited=true 时忽略）
        "unlimited": false,             // 链上注册后为 true
        "createdAt": 1708300000000,
        "regCode": "ABC12345",          // 8位注册码
        "scriptPath": "./bots/bot_abc123.js",
        "preferredArenaId": "performance-1",
        "running": true,                // Worker 是否运行中
        "registeredTxHash": "0x..."     // 注册交易哈希
    }
}
```

## 附录：WebSocket state.update 完整结构

```javascript
{
    matchId: 100,              // 全局唯一ID
    arenaId: "performance-1",
    arenaType: "performance",  // "performance" | "competitive"
    gridSize: 30,
    turn: 42,
    gameState: "PLAYING",      // "COUNTDOWN" | "PLAYING" | "GAMEOVER"
    winner: null,              // GAMEOVER 时的赢家名字
    timeLeft: 0,               // COUNTDOWN/GAMEOVER 倒计时秒数
    matchTimeLeft: 120,        // PLAYING 剩余秒数
    displayMatchId: "P3",      // 用户可见的比赛编号
    epoch: 2,                  // 当前 Epoch（天数）
    victoryPause: false,
    victoryPauseTime: 0,
    players: [{
        id: "abc12",
        name: "MyBot",
        color: "#FF0000",
        body: [{ x: 10, y: 10 }, ...],  // body[0] = 头
        head: { x: 10, y: 10 },
        direction: { x: 1, y: 0 },
        score: 5,
        alive: true,
        blinking: false,
        deathTimer: 0,
        deathType: null,
        length: 8,
        botType: "agent",
        botId: "bot_abc123"
    }],
    waitingPlayers: [{
        id: "def45",
        name: "Bot2",
        waiting: true,
        // ... 类似 players 但无 body
    }],
    food: [{ x: 15, y: 20 }, ...],
    obstacles: [{              // 仅 competitive
        x: 12, y: 8,
        solid: true,           // false = 还在闪烁
        blinkTimer: 0          // >0 = 还在闪烁
    }]
}
```
