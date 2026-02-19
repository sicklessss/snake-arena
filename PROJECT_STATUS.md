# Snake Arena — 项目全状态文档

> **最后更新：2026-02-19**
> 作者：airdropclaw
> 仓库：https://github.com/sicklessss/snake-arena

---

## 一、项目简介

Snake Arena 是一个 **链上 AI Bot 对战平台**。玩家用 JavaScript 编写自己的蛇形 AI 机器人，上传到服务器后自动参与实时对战；观众可以通过浏览器实时观看比赛、下注投票；Bot 赢得比赛后可通过区块链合约领取 ETH 奖励。

**技术栈：**
- 后端：Node.js (Express + WebSocket) — `server.js`
- 前端：React 19 + Vite + TypeScript + RainbowKit
- 区块链：Base Sepolia（测试网，ChainID: 84532），Solidity + Hardhat
- 运行环境：VPS（Ubuntu，IP: 107.174.228.72），PM2 进程管理

---

## 二、目前系统状态（2026-02-19）

| 模块 | 状态 | 备注 |
|------|------|------|
| 后端服务器 | ✅ 运行中 | PM2 id=16，port 3000 |
| 前端 React | ✅ 已部署 | 访问 http://107.174.228.72:3000 |
| 智能合约 | ✅ 已部署 | Base Sepolia，v5.1 版本 |
| AI Agents | ✅ 运行中 | ws-agent x9 + hero-ai x1 |
| 回放系统 | ✅ 正常 | 自动清理，保留最近 200 个 |
| 注册费 | ✅ 已设置 | 0.0001 ETH（链上） |

---

## 三、目录结构

```
snake-arena/                          ← 后端（GitHub master 分支）
├── server.js                         主服务器 (~2100行)，包含所有游戏逻辑
├── sandbox-worker.js                 Bot 沙盒执行 (Node vm 模块 + Worker 线程)
├── ecosystem.config.js               PM2 进程配置（snake-server + ws-agent x9 + hero-ai）
├── hero-agent.js                     英雄级 AI Bot（A* 路径算法）
├── agent.js / bot.js                 Bot 编写示例
├── hardhat.config.js                 合约编译配置（读 PRIVATE_KEY 环境变量）
├── package.json
│
├── contracts/                        Solidity 合约源码
│   ├── BotRegistry.sol               Bot 注册/所有权/市场
│   ├── SnakeBotNFT.sol               Bot ERC-721 NFT
│   ├── RewardDistributor.sol         Bot 奖励分配（owner = PariMutuel 合约）
│   ├── SnakeArenaPariMutuel.sol      互注投注池（已修复 withdrawPlatformFees）
│   └── ReferralRewards.sol           EIP-712 推荐奖励
│
├── artifacts/                        编译产物（已追踪到 git）
├── ARCHITECTURE.md                   技术架构详细文档（中文）
├── PROJECT_STATUS.md                 本文件（项目状态 + 续工指南）
│
├── bots/                             [gitignored] 用户上传的 Bot JS 脚本
├── replays/                          [gitignored] 比赛回放 JSON（自动限制200个）
├── data/                             [gitignored] Bot 注册表、推荐记录
├── history.json                      [gitignored] 比赛历史
├── .env                              [gitignored] 环境变量（含加密私钥）
└── public/                           前端静态文件（由 snake-arena-next 构建后 rsync）

snake-arena-next/                     ← 前端（GitHub snake-arena-next 分支）
├── src/
│   ├── App.tsx                       主 React 组件（所有 UI，~60KB）
│   ├── contracts.ts                  合约地址 + ABI
│   ├── main.tsx                      入口
│   └── App.css / index.css
└── dist/                             构建产物（rsync 同步到 VPS public/）
```

---

## 四、完整架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 / Bot 开发者                          │
│                                                                   │
│    浏览器（React 前端）                 Bot 脚本（本地 JS 文件）     │
│    RainbowKit + Wagmi + Viem           通过前端 UI 上传             │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP API + WebSocket
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              VPS：107.174.228.72:3000                             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  server.js (Express + WS)                 │    │
│  │                                                           │    │
│  │   GameRoom x10 (performance)  GameRoom x2 (competitive)  │    │
│  │        每 125ms 一帧（8fps）    带随机障碍物                │    │
│  │                    │                                      │    │
│  │      Worker 线程池 (sandbox-worker.js)                    │    │
│  │      每个 Bot 独立沙盒，Node vm 模块，屏蔽危险 API          │    │
│  │                    │                                      │    │
│  │   HTTP API 30+ 端点    WebSocket 游戏协议                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  数据持久化（PM2 重启不丢失）：                                    │
│  history.json | replays/ | bots/ | data/ | .env                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ ethers.js v6（Base Sepolia RPC）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Base Sepolia 区块链（测试网）                     │
│                                                                   │
│  BotRegistry         Bot 注册/所有权/市场，注册费 0.0001 ETH       │
│  SnakeBotNFT         每个 Bot 一个 ERC-721 NFT                    │
│  RewardDistributor   Bot 赢得比赛后积累 ETH 奖励，可领取           │
│  PariMutuel          互注投注池（5% 平台费 + 5% Bot 奖励 + 90% 投注者）│
│  ReferralRewards     EIP-712 签名推荐奖励                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、智能合约地址（v5.1，已部署）

| 合约 | 地址 | 说明 |
|------|------|------|
| BotRegistry | `0x93331E5596852ed9bB283fb142ac2bBc538F7DfC` | Bot 注册、转让、市场 |
| SnakeBotNFT | `0xA5EC2452D95bEc7eb1E0D90205560b83DAb37D13` | ERC-721 NFT |
| RewardDistributor | `0xB354e3062b493466da0c1898Ede5aabF56279046` | 奖励分配（owner = PariMutuel） |
| **SnakeArenaPariMutuel** | **`0xAd03bf88D39Fb1A4380A2dF3A06C66B8f9147ae6`** | 互注投注池（本次重新部署） |
| ReferralRewards | `0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F` | 推荐奖励 |

> **重要：** PariMutuel 是本次更新重新部署的（修复了 `withdrawPlatformFees` bug），其余合约沿用旧版本。
> **RewardDistributor 的 owner 已转移给新的 PariMutuel 合约。**

---

## 六、关键业务流程

### 6.1 注册并上线一个 Bot

```
1. 玩家在前端点击"Register Bot"
2. 输入 register code（注册码，由平台管理员提供）
3. POST /api/bot/register → 服务器创建链上 NFT，分配 botId
4. 上传 JS 脚本：POST /api/bot/upload?botId=xxx&name=xxx&owner=0x...
5. Bot 自动进入游戏房间，开始对战
```

### 6.2 修改 Bot 代码（重复上传）

```
前端"Edit"按钮 → BotUploadModal 弹出编辑器
→ POST /api/bot/upload?botId=xxx（携带已有 botId，覆盖旧脚本）
→ 下次 Bot Worker 重启时加载新代码
```

> **注意：** 上传 URL 必须包含 `botId` 参数，否则重新上传时会报"名称已被占用"。App.tsx 第 215 行已修复此 bug。

### 6.3 比赛结算流程

```
游戏结束 → server.js 记录获胜者 → settleMatch(matchId, [1st, 2nd, 3rd])
→ PariMutuel 合约
   → 5% 平台费积累到 accumulatedPlatformFees
   → 5% 调用 RewardDistributor.accumulateReward() 给 Bot 设计者
   → 90% 留给投注者，按比例领取
```

### 6.4 Bot 奖励领取

```
Bot 在 RewardDistributor 合约中积累 ETH 奖励
→ 前端"Claim"按钮
→ 调用 RewardDistributor.claimRewards(botId)
→ 奖励转入 Bot owner 钱包
（最低领取门槛：0.001 ETH）
```

---

## 七、API 端点速查

### Bot 管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| `POST` | `/api/bot/register` | 注册新 Bot | 注册码 |
| `POST` | `/api/bot/register-unlimited` | 内部注册（无需码） | Admin Key |
| `POST` | `/api/bot/upload` | 上传/更新 Bot 脚本 | 限流 10次/min |
| `POST` | `/api/bot/claim` | 钱包认领 Bot 所有权 | 钱包签名 |
| `GET` | `/api/bot/registration-fee` | 查询链上注册费 | — |
| `GET` | `/api/bot/:botId` | 查询 Bot 信息 | — |
| `GET` | `/api/bot/:botId/credits` | 查询余额 | — |
| `POST` | `/api/bot/topup` | 充值 credits | Admin Key |

### 游戏数据

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/leaderboard/global` | 全局排行榜 |
| `GET` | `/api/replays` | 回放列表 |
| `GET` | `/api/replay/:matchId` | 获取回放数据 |
| `GET` | `/api/user/onchain-bots?wallet=` | 用户链上 Bot 列表 |
| `GET` | `/api/marketplace/listings` | 市场在售 Bot |

### 推荐系统

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/referral/record` | 记录推荐关系 |
| `POST` | `/api/referral/claim-proof` | 获取链下签名 |
| `GET` | `/api/referral/info/:address` | 查询推荐统计 |

---

## 八、WebSocket 协议

### 客户端 → 服务器

```json
// 加入游戏
{ "type": "join", "name": "BotName", "botId": "xxx", "arenaType": "performance" }

// 每帧移动（服务器触发，bot 需在 125ms 内响应）
{ "type": "move", "direction": { "x": 1, "y": 0 } }
```

### 服务器 → 客户端

```json
// 初始化
{ "type": "init", "id": "player_id", "gridSize": 30 }

// 进入等待队列
{ "type": "queued", "id": "player_id", "entryPrice": 0.001 }

// 每帧状态更新（125ms）
{
  "type": "update",
  "state": {
    "matchId": 100, "arenaId": "performance-1",
    "turn": 42, "gameState": "PLAYING", "timeLeft": 120,
    "players": [{ "id": "x", "name": "Bot", "body": [...], "alive": true, "score": 5 }],
    "food": [{ "x": 10, "y": 15 }],
    "obstacles": []
  }
}

// 踢出
{ "type": "kicked", "reason": "full | outbid" }
```

---

## 九、VPS 操作指南

### SSH 连接

```bash
ssh -p 2232 root@107.174.228.72
```

### PM2 常用命令

```bash
pm2 status                    # 查看所有进程状态
pm2 logs snake-server         # 实时查看服务器日志
pm2 restart snake-server      # 重启主服务器
pm2 restart all               # 重启所有进程
pm2 logs snake-server --lines 50 --nostream   # 查看最近50行日志
```

### 拉取最新代码并重启

```bash
cd /root/snake-arena
git pull origin master
pm2 restart snake-server
```

### 查看回放占用空间

```bash
du -sh /root/snake-arena/replays/
ls /root/snake-arena/replays/ | wc -l
```

---

## 十、前端开发与部署

### 本地开发

```bash
cd snake-arena-next
npm install
npm run dev          # 本地预览（Vite dev server）
```

### 构建并部署到 VPS

```bash
cd snake-arena-next
npm run build        # 生成 dist/

# 同步到 VPS（替换 YOUR_KEY_PATH）
rsync -az --delete -e "ssh -p 2232" dist/ root@107.174.228.72:/root/snake-arena/public/
```

> **注意：** 前端修改后必须手动 build + rsync，不会自动同步。

### 关键文件位置

| 文件 | 作用 |
|------|------|
| `src/App.tsx` | 所有 UI 逻辑（~60KB，单文件组件） |
| `src/contracts.ts` | 合约地址和 ABI |

---

## 十一、密钥与安全

### 密钥存储位置

| 密钥 | 存储位置 | 操作方式 |
|------|----------|----------|
| Owner 私钥（`0xBa379b9...`） | **仅在用户本地**（1Password 或安全位置） | 手动导入，用于合约管理 |
| Backend 私钥（`0x958a640...`） | VPS `/root/backend-private-key-v2.age`（age 加密） | 服务器启动时自动解密注入 |
| Admin Key | VPS `/root/snake-arena/.env` | 用于管理 API 鉴权 |

### .env 文件结构（VPS）

```env
PORT=3000
BACKEND_PRIVATE_KEY=0x...        # 后端钱包私钥（解密后）
ADMIN_KEY=sk-...                 # 管理接口鉴权密钥
BOT_REGISTRY_CONTRACT=0x93331...
REWARD_DISTRIBUTOR_CONTRACT=0xB354...
PARIMUTUEL_CONTRACT=0xAd03b...
NFT_CONTRACT=0xA5EC2...
REFERRAL_CONTRACT=0xfAA05...
```

### 确认安全状态

- ✅ `.env` 在 `.gitignore` 中，**从未上传 GitHub**
- ✅ 所有 deploy 脚本在 `.gitignore` 中（含一次性配置脚本）
- ✅ `deploy-contracts.js`（旧版，含无关测试账户私钥）已从 git 追踪中移除
- ✅ Owner 私钥从未存入服务器或代码库

---

## 十二、已完成的重要修复和优化

### 合约修复
- **`withdrawPlatformFees()` bug**：原来会提取合约全部余额（包括投注者的钱）；修复后引入 `accumulatedPlatformFees` 状态变量，只提取平台应得部分
- **OpenZeppelin v5 兼容性**：所有合约从 OZ v4 API 升级到 v5（`Ownable(msg.sender)` 构造函数、`_requireOwned()` 替换 `_exists()`）

### 服务器修复
- **重复路由删除**：删除了重复的 `/api/bot/registration-fee` 路由（原有两处，保留位于第 1990 行有注释的版本）
- **回放自动清理**：服务器启动时执行一次清理，之后每 24 小时自动清理，保留最近 200 个回放（节省磁盘，历史曾累积 25GB）
- **`/api/bot/register-unlimited` 鉴权**：修复了原本无需鉴权即可调用的安全漏洞

### 前端修复
- **Bot 重复上传 bug**：上传 URL 缺少 `botId` 参数，导致重新上传时报"名称已被占用"（已在 App.tsx:215 修复）
- **UI 文字调整**：`placeholder` 改为 "register code"，注册费默认值 `0.01` → `0.0001`，"NFT bot" → "bot"

### 运营操作
- **注册费上链**：调用 `BotRegistry.setRegistrationFee(0.0001 ETH)` 设置链上费用
- **ADMIN_KEY 轮换**：生成新密钥 `sk-_CUdKpnZD2n2WECS7C4tNrUyjblrr4F4`（已更新到 VPS .env）
- **旧回放清理**：从 38,075 个文件（25GB）清理到 200 个（786MB），释放约 24GB

---

## 十三、待处理事项（可选）

| 优先级 | 任务 | 说明 |
|--------|------|------|
| 中 | VPS git pull + 重启 | 最新 server.js 改动（重复路由删除 + 自动清理）已推送 GitHub，VPS 暂未 pull（SSH 连接超时，需手动操作） |
| 低 | 竞技场入场费硬编码 | App.tsx 第 1171、1180 行有 `0.001 ETH` 硬编码，可考虑从 API 动态读取 |
| 低 | git 历史清理 | `deploy-contracts.js` 曾含测试私钥，虽已从追踪移除，但 git 历史仍有记录；可用 `git filter-branch` 彻底清除（风险：改写历史） |

---

## 十四、本地开发快速启动

```bash
# 克隆后端
git clone https://github.com/sicklessss/snake-arena.git
cd snake-arena
npm install

# 配置环境变量
cp .env.example .env    # 填写私钥和合约地址

# 启动
node server.js          # 单进程启动

# 或使用 PM2
pm2 start ecosystem.config.js
```

---

## 十五、如何让 Claude Code 快速接手

下次开始工作时，可以这样说：

> "打开 `/Users/airdropclaw/.openclaw/workspace-agent-a/snake-arena/PROJECT_STATUS.md`，了解项目状态后继续工作。"

Claude Code 读完本文件后即可快速掌握项目背景，无需重新解释。

**仓库路径：**
- 后端：`/Users/airdropclaw/.openclaw/workspace-agent-a/snake-arena`
- 前端：`/Users/airdropclaw/.openclaw/snake-arena-next`
