# Snake Arena — 系统架构文档

> 最后更新：2026-02-19

---

## 目录

1. [整体概览](#整体概览)
2. [目录结构](#目录结构)
3. [后端服务器 (server.js)](#后端服务器)
4. [游戏房间逻辑](#游戏房间逻辑)
5. [沙盒执行环境 (sandbox-worker.js)](#沙盒执行环境)
6. [智能合约](#智能合约)
7. [前端 (React/Vite)](#前端)
8. [数据持久化](#数据持久化)
9. [部署信息](#部署信息)
10. [关键业务流程](#关键业务流程)
11. [安全机制](#安全机制)

---

## 整体概览

Snake Arena 是一个链上 Bot 对战平台，玩家编写 AI 代码，让自己的蛇形 Bot 在竞技场中相互竞争，并通过区块链合约赚取奖励。

```
┌─────────────────────────────────────────────────────────────┐
│                        用户/Bot开发者                         │
│                            │                                  │
│          ┌─────────────────┴──────────────────┐              │
│          │  浏览器 (React前端)                   │  Bot脚本     │
│          │  RainbowKit + Wagmi + Viem           │  (JS文件)    │
│          └─────────────┬────────────────────────┘  │         │
│                        │ HTTP / WebSocket            │         │
└────────────────────────┼────────────────────────────┼─────────┘
                         ▼                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   VPS (107.174.228.72:3000)                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    server.js (Express + WS)           │   │
│  │                                                        │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │   │
│  │  │ GameRoom x10│  │ GameRoom x2  │  │  HTTP API   │  │   │
│  │  │ performance  │  │ competitive  │  │  30+ 端点   │  │   │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  │   │
│  │         │                │                  │          │   │
│  │  ┌──────▼────────────────▼──────────────────▼──────┐  │   │
│  │  │         Worker 线程池 (sandbox-worker.js)        │  │   │
│  │  │         每个 Bot 一个独立沙盒 (vm 模块)           │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  持久化: history.json  |  replays/  |  bots/  |  data/      │
└─────────────────────────────────────────┬────────────────────┘
                                          │ ethers.js (Base Sepolia)
                                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Base Sepolia 区块链                        │
│                                                              │
│  BotRegistry  │  SnakeBotNFT  │  RewardDistributor          │
│  PariMutuel   │  ReferralRewards                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
snake-arena/                          ← 后端（master 分支）
├── server.js                         主服务器（~2100行，所有游戏逻辑）
├── sandbox-worker.js                 Bot 沙盒执行 Worker 线程
├── hero-agent.js                     示例英雄级 AI Bot
├── agent.js                          HTTP Bot 示例
├── bot.js                            WebSocket Bot 示例
├── ecosystem.config.js               PM2 进程配置
├── hardhat.config.js                 Hardhat 编译配置（读取 PRIVATE_KEY 环境变量）
├── package.json
│
├── contracts/                        Solidity 合约源码
│   ├── BotRegistry.sol               Bot 注册、所有权、市场
│   ├── SnakeBotNFT.sol               Bot 的 ERC-721 NFT
│   ├── RewardDistributor.sol         Bot 奖励分配（onlyOwner = PariMutuel）
│   ├── SnakeArenaPariMutuel.sol      互注投注池（已修复 withdrawPlatformFees）
│   └── ReferralRewards.sol           EIP-712 链下签名推荐奖励
│
├── artifacts/                        Hardhat 编译产物（已追踪，勿手动修改）
├── bots/                             已上传的 Bot JS 脚本（gitignored）
├── replays/                          比赛回放 JSON（gitignored，约 20GB）
├── data/                             本地数据（gitignored）
├── history.json                      比赛历史记录（gitignored）
├── public/                           前端静态文件（由前端 build 后 rsync）
└── .env                              环境变量（gitignored，包含加密后的密钥）

snake-arena-next/                     ← 前端（snake-arena-next 分支）
├── src/
│   ├── App.tsx                       主组件（所有 UI 逻辑，~60KB）
│   ├── contracts.ts                  合约地址 + ABI
│   ├── main.tsx                      入口
│   └── App.css / index.css
├── dist/                             构建产物（rsync 到 VPS public/）
└── vite.config.ts
```

---

## 后端服务器

### 全局配置常量

| 常量 | 值 | 说明 |
|------|----|------|
| `gridSize` | 30 | 地图 30×30 格 |
| `MATCH_DURATION` | 180s | 每局 3 分钟 |
| `MAX_FOOD` | 5 | 最多 5 个食物 |
| `DEATH_BLINK_TURNS` | 24 | 死亡闪烁帧数 |
| `TICK_RATE` | 125ms | 游戏帧率（8fps） |
| `MAX_WORKERS` | 300 | 最大 Worker 线程数 |

### HTTP API 端点（30+）

#### Bot 管理
| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/bot/register` | 注册新 Bot（需注册码） | 注册码 |
| `POST` | `/api/bot/register-unlimited` | 无限制注册（内部） | Admin Key |
| `POST` | `/api/bot/upload` | 上传/更新 Bot 脚本 | 限流 10次/min |
| `POST` | `/api/bot/claim` | 链上领取 Bot 所有权 | 钱包签名 |
| `GET` | `/api/bot/registration-fee` | 查询链上注册费 | - |
| `GET` | `/api/bot/lookup?name=` | 按名称查 Bot | - |
| `GET` | `/api/bot/:botId` | 查询 Bot 信息 | - |
| `GET` | `/api/bot/:botId/credits` | 查余额 | - |
| `POST` | `/api/bot/topup` | 充值 credits | Admin Key |
| `POST` | `/api/bot/start` | 启动 Bot Worker | Admin Key |
| `POST` | `/api/bot/stop` | 停止 Bot Worker | Admin Key |

#### 用户 & 市场
| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/user/onchain-bots?wallet=` | 获取链上用户 Bot 列表 |
| `GET` | `/api/marketplace/listings` | 市场上架 Bot |
| `GET` | `/api/leaderboard/global` | 全局排行榜 |
| `GET` | `/api/leaderboard/:arenaId` | 特定竞技场排行 |
| `GET` | `/api/replays` | 回放列表 |
| `GET` | `/api/replay/:matchId` | 获取回放数据 |

#### 推荐系统
| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/referral/record` | 记录推荐关系 |
| `POST` | `/api/referral/claim-proof` | 获取链下签名以领取奖励 |
| `GET` | `/api/referral/info/:address` | 查询推荐统计 |

### WebSocket 消息协议

#### 客户端 → 服务器
```json
// 加入游戏
{ "type": "join", "name": "BotName", "botId": "xxx", "arenaType": "performance" }

// 发送移动方向（每帧）
{ "type": "move", "direction": { "x": 1, "y": 0 } }
```

#### 服务器 → 客户端
```json
// 初始化
{ "type": "init", "id": "player_id", "gridSize": 30 }

// 进入等待队列
{ "type": "queued", "id": "player_id", "entryPrice": 0.01 }

// 每帧状态更新（125ms 一次）
{
  "type": "update",
  "state": {
    "matchId": 100, "arenaId": "performance-1",
    "turn": 42, "gameState": "PLAYING",
    "timeLeft": 120,
    "players": [{ "id": "x", "name": "Bot", "body": [...], "alive": true, "score": 5 }],
    "food": [{ "x": 10, "y": 15 }],
    "obstacles": []
  }
}

// 被踢出
{ "type": "kicked", "reason": "full | outbid" }
```

---

## 游戏房间逻辑

### 房间类型

| 类型 | 数量 | 说明 |
|------|------|------|
| `performance-1` ~ `performance-10` | 10 个 | 表演场，Agent Bot 测试，付费入场 |
| `competitive-1` | 1 个 | 竞技场，有随机障碍物，更高强度 |

### 生命周期

```
COUNTDOWN (5s)
    ↓ 达到最少玩家数
PLAYING (180s)  ←─ 每 125ms 一帧
    │  检测输入 → 移动蛇身 → 碰撞检测 → 吃食物 → 广播状态
    ↓ 时间到 or 只剩1人
GAME_OVER
    │  保存历史 → 保存回放
    ↓
COUNTDOWN (下一局)
```

### 死亡类型

| 类型 | 原因 |
|------|------|
| `wall` | 撞到边界 |
| `self` | 撞到自身 |
| `eaten` | 被更长的蛇吃掉 |
| `collision` | 撞到其他蛇身体 |
| `headon` | 两蛇头对撞 |
| `corpse` | 撞到死蛇尸体 |
| `obstacle` | 撞到障碍物（仅竞技场） |
| `disconnect` | 断线 |

### 竞技场特殊机制

- 每 50 帧随机生成 1~12 格障碍物
- 死蛇尸体自动转换为障碍物
- 障碍物新生成时带闪烁效果

---

## 沙盒执行环境

`sandbox-worker.js` 在独立 Worker 线程中使用 Node.js `vm` 模块执行用户上传的 Bot 脚本。

### 可用 API（Bot 脚本内）

```javascript
// 连接服务器
const ws = new WebSocket(CONFIG.serverUrl);

// 配置信息
CONFIG.serverUrl  // ws://127.0.0.1:3000?...
CONFIG.botId      // bot的ID

// 输出（重定向到父线程日志）
console.log / console.error
```

### 被屏蔽的危险 API

```
require / import   fs / net / http / https / child_process
eval / Function    process.env    __dirname / __filename
```

---

## 智能合约

**网络：** Base Sepolia（ChainID: 84532）

### 合约地址（v5.1，2026-02-19）

| 合约 | 地址 |
|------|------|
| BotRegistry | `0x93331E5596852ed9bB283fb142ac2bBc538F7DfC` |
| SnakeBotNFT | `0xA5EC2452D95bEc7eb1E0D90205560b83DAb37D13` |
| RewardDistributor | `0xB354e3062b493466da0c1898Ede5aabF56279046` |
| **SnakeArenaPariMutuel** | **`0xAd03bf88D39Fb1A4380A2dF3A06C66B8f9147ae6`** |
| ReferralRewards | `0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F` |

### BotRegistry.sol

Bot 注册、所有权管理、二手市场。

- 每用户最多 5 个 Bot
- 注册需支付 `registrationFee`（链上设定）
- 支持上架出售和购买 Bot

### SnakeBotNFT.sol

基于 ERC-721，每个 Bot 对应一个 NFT 代币。

### RewardDistributor.sol

积累并分配 Bot 赚取的奖励。

- **owner 为 SnakeArenaPariMutuel 合约**（这样 settleMatch 才能调用 accumulateReward）
- 最小提取门槛：0.001 ETH

### SnakeArenaPariMutuel.sol

互注投注池，费用分配：

```
总投注池
├── 5%  平台费（withdrawPlatformFees，只提取 accumulatedPlatformFees）
├── 5%  Bot 设计者奖励（1st: 3%, 2nd: 1.5%, 3rd: 0.5%）
└── 90% 投注者奖励（1st: 45%, 2nd: 27%, 3rd: 18%）
```

**关键修复（v5.1）：** `withdrawPlatformFees()` 改为只提取追踪的平台费，不再提取合约全部余额。

### ReferralRewards.sol

EIP-712 链下签名 + 链上验证的推荐奖励系统，防止重放攻击（nonce 递增）。

---

## 前端

**技术栈：** React 19 + Vite + TypeScript + RainbowKit + Wagmi + Viem

### 主要组件（App.tsx）

| 组件 | 功能 |
|------|------|
| `BotPanel` | 显示用户的 Bot 列表（最多5个），管理Bot |
| `BotSlot` | 单个 Bot 卡片，包含注册、上传、查看按钮 |
| `BotUploadModal` | Bot JS 代码编辑器，支持初次上传和重复修改 |
| `BotClaimByName` | 通过名称+钱包签名领取已有 Bot |
| `GameDisplay` | 实时游戏画面（Canvas 渲染） |
| `Leaderboard` | 全局排行榜 |
| `BettingPanel` | 对局投注 |

### 构建 & 部署

```bash
# 本地构建
cd snake-arena-next && npm run build

# 同步到 VPS（由 Claude 执行）
rsync -az --delete -e "ssh -p 2232" dist/ root@107.174.228.72:/root/snake-arena/public/
```

---

## 数据持久化

| 文件/目录 | 内容 | 重启是否保留 |
|-----------|------|-------------|
| `history.json` | 所有比赛记录（matchId、获胜者、时间） | ✅ 保留 |
| `replays/match-N.json` | 完整比赛帧回放数据（约 20GB） | ✅ 保留 |
| `bots/bot_xxx.js` | 已上传的 Bot 脚本 | ✅ 保留 |
| `data/bots.json` | Bot 注册表（名称、类型、owner、credits） | ✅ 保留 |
| `data/referrals.json` | 推荐关系和奖励记录 | ✅ 保留 |
| `.env` | 环境变量（端口、合约地址、加密密钥） | ✅ 保留 |

以上所有文件均在 `.gitignore` 中，**不会被 git 操作影响**，PM2 重启仅重启 Node.js 进程，文件不受影响。

---

## 部署信息

### VPS

```
IP:   107.174.228.72
SSH:  ssh -p 2232 root@107.174.228.72
Port: 3000
```

### PM2 进程

```
snake-server   (id 16)  — 主游戏服务器，port 3000
ws-agent x9    (id 2-10) — AI agent Worker
hero-ai        (id 1)   — 英雄级示范 AI
```

### 密钥管理

| 密钥 | 存储方式 |
|------|----------|
| Owner 私钥 | 用户本地 1Password，**从不上传** |
| Backend 私钥 | VPS 上 `backend-private-key-v2.age`（age 加密），服务器启动时解密 |
| Admin Key | VPS `.env` 文件 |
| Hardhat 编译/部署 | 通过 `PRIVATE_KEY` 环境变量传入，不写入代码 |

### 两个 Git 分支

| 分支 | 目录 | 内容 |
|------|------|------|
| `master` | `/workspace-agent-a/snake-arena` | 后端服务器 + 合约 |
| `snake-arena-next` | `/snake-arena-next` | 前端 React 应用 |

---

## 关键业务流程

### Bot 上传和上线

```
1. 用户编写 Bot JS 脚本（使用 WebSocket API）
2. POST /api/bot/upload?botId=xxx&name=xxx&owner=0x...
   → 安全扫描（禁止 require/eval/fs 等）
   → 保存到 bots/ 目录
   → 更新 data/bots.json
3. Bot 自动进入游戏房间
```

### Bot 代码更新

```
前端"Edit"按钮 → BotUploadModal → POST /api/bot/upload?botId=xxx（带已有 botId）
→ 覆盖脚本文件 → 下次 Bot 重连时加载新代码
```

### 比赛结算

```
后端 settleMatch(matchId, [winner1, winner2, winner3])
→ PariMutuel 合约
  → 计算 platformFee（追踪到 accumulatedPlatformFees）
  → 调用 RewardDistributor.accumulateReward() 给 Bot 设计者
  → 90% 留给投注者按比例领取
```

---

## 安全机制

| 机制 | 实现 |
|------|------|
| Bot 脚本沙盒 | vm 模块 + 禁用关键词 + Worker 线程隔离 |
| API 鉴权 | Admin Key（管理操作）+ 钱包签名（用户操作） |
| 防重放 | `/claim` 接口 5 分钟时间窗口 + 签名验证 |
| 合约安全 | ReentrancyGuard + Pausable + onlyOwner |
| 私钥保护 | age 加密存储，Owner 密钥仅本地持有 |
| Git 安全 | deploy 脚本、.env、私钥文件全部 gitignore |
