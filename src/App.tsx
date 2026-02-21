import React, { useState, useEffect, useRef } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, parseUnits, stringToHex, padHex, createPublicClient, http } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import './index.css';
import { CONTRACTS, BOT_REGISTRY_ABI, PARI_MUTUEL_ABI, ERC20_ABI, BOT_MARKETPLACE_ABI, SNAKE_BOT_NFT_ABI } from './contracts';
import foodSvgUrl from './assets/food.svg';

// --- CONFIG ---
const config = getDefaultConfig({
  appName: 'Snake Arena',
  // WalletConnect projectId — register at https://cloud.walletconnect.com
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '7e5c5e3e3f5e5c5e3f5e5c5e3f5e5c5e',
  chains: [baseSepolia],
  ssr: false,
});

const queryClient = new QueryClient();

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });


const PERFORMANCE_RULES = `游戏介绍

Snake Arena 是一个实时多人贪吃蛇竞技场，玩家或AI bot在同一张地图中比拼生存与吞噬。

规则概览

1) 地图与节奏
- 地图：30×30
- 回合：125ms/次（约8FPS）
- 每局：180秒
- 食物上限：5个

2) 出生与移动
- 固定出生点，初始长度=3
- 不能立刻反向

3) 死亡
- 撞墙 / 自撞 / 撞尸体：死亡

4) 蛇对蛇
- 头对头：更长者生存；同长同死
- 头撞到别人身体：更长者"吃掉"对方一段；更短者死亡

5) 胜负
- 仅剩1条：胜 | 全灭：No Winner | 时间到：最长者胜
`;

const COMPETITIVE_RULES = `⚔️ 竞技场规则

竞技场是高级赛场，只有已注册的 Agent Bot 才能参赛。

与表演场的不同：
🧱 障碍物系统
- 比赛期间每10秒随机生成障碍物（1×1 ~ 4×4 不规则形状）
- 障碍物生成时闪烁2秒（黄色闪烁），此时可以穿越
- 闪烁结束后变为实体障碍（红色），蛇撞上即死

💰 进场机制
- 默认：系统随机从已注册 Agent Bot 中挑选上场
- 付费进场：支付 0.001 ETH 可选择指定场次上场
- 付费进场的 bot 该场结束后回到随机挑选状态

📋 基础规则同表演场
- 5秒赛前准备 → 3分钟比赛 → 5秒休息
- 30×30 地图 | 125ms/tick | 食物上限5个
`;

// Helper: encode bot name to bytes32
function nameToBytes32(name: string): `0x${string}` {
  return padHex(stringToHex(name, { size: 32 }), { size: 32 });
}

// --- COMPONENTS ---

// Issue 1: Bot Management with 5 slots, scrollable
function BotManagement() {
  const { isConnected, address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [bots, setBots] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [sellBot, setSellBot] = useState<any>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [sellStatus, setSellStatus] = useState('');
  const [sellBusy, setSellBusy] = useState(false);
  // Edit modal state
  const [editBot, setEditBot] = useState<any>(null);
  const [editCode, setEditCode] = useState('');
  const [editToken, setEditToken] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const { writeContract, data: regHash, isPending: regPending, error: regError } = useWriteContract();
  const { isLoading: regConfirming, isSuccess: regConfirmed } = useWaitForTransactionReceipt({ hash: regHash });

  const guideUrl = 'http://107.174.228.72:3000/SNAKE_GUIDE.md';

  const handleCopy = () => {
    const doCopy = (text: string) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return Promise.resolve();
    };
    doCopy(guideUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Edit: request signature, get edit token, load code
  const handleEditOpen = async (bot: any) => {
    if (!isConnected || !address) return alert('Connect Wallet first');
    setEditBot(bot);
    setEditCode('');
    setEditToken('');
    setEditStatus('Requesting wallet signature...');
    setEditBusy(true);
    try {
      const timestamp = Date.now().toString();
      const message = `Snake Arena Edit: ${bot.botId} at ${timestamp}`;
      const provider = (window as any).ethereum;
      if (!provider) { setEditStatus('No wallet found'); setEditBusy(false); return; }
      const { BrowserProvider } = await import('ethers');
      const ethProvider = new BrowserProvider(provider);
      const signer = await ethProvider.getSigner();
      const signature = await signer.signMessage(message);

      setEditStatus('Verifying NFT ownership...');
      const res = await fetch('/api/bot/edit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: bot.botId, address, signature, timestamp }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'not_nft_owner') {
          setEditStatus('You do not own the NFT for this bot');
        } else {
          setEditStatus(data.message || data.error || 'Failed to get edit token');
        }
        setEditBusy(false);
        return;
      }

      setEditToken(data.token);
      setEditStatus('Loading bot code...');
      const codeRes = await fetch(`/api/bot/${bot.botId}/code`, {
        headers: { 'x-edit-token': data.token },
      });
      if (codeRes.ok) {
        const codeData = await codeRes.json();
        setEditCode(codeData.code || '');
        setEditStatus('');
      } else {
        const errData = await codeRes.json();
        setEditCode('');
        setEditStatus(errData.message || 'No code found — write your bot code below');
      }
    } catch (e: any) {
      setEditStatus(e?.message || 'Error');
    }
    setEditBusy(false);
  };

  // Save edited code
  const handleEditSave = async () => {
    if (!editBot || !editToken) return;
    setEditBusy(true);
    setEditStatus('Saving...');
    try {
      const res = await fetch(`/api/bot/upload?botId=${editBot.botId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/javascript', 'x-edit-token': editToken },
        body: editCode,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEditStatus('Saved! Bot restarting...');
        setTimeout(() => { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); }, 1500);
      } else {
        setEditStatus(data.message || data.error || 'Save failed');
      }
    } catch (e: any) {
      setEditStatus(e?.message || 'Save failed');
    }
    setEditBusy(false);
  };

  // Fetch user's bots from server
  useEffect(() => {
    if (!address) { setBots([]); return; }
    const fetchBots = async () => {
      try {
        const res = await fetch('/api/user/onchain-bots?wallet=' + address);
        if (res.ok) {
          const data = await res.json();
          setBots(data.bots || []);
        }
      } catch (e) { console.error(e); }
    };
    fetchBots();
    const t = setInterval(fetchBots, 10000);
    return () => clearInterval(t);
  }, [address]);

  // Register: server creates bot on-chain first (blocking), then user calls registerBot
  const handleRegister = async () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!newName) return alert('Enter Bot Name');

    try {
      setRegStatus('Creating bot (waiting for on-chain confirmation)...');
      const res = await fetch('/api/bot/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, owner: address, botType: 'agent' })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setRegStatus('⚠️ ' + (data.message || data.error || 'Failed'));
        return;
      }

      if (!data.onChainReady) {
        setRegStatus('⚠️ On-chain creation failed. Bot created locally but cannot register on-chain yet.');
        return;
      }

      setRegStatus('Sign on-chain registration (0.01 ETH)...');
      const botId32 = nameToBytes32(data.id);
      writeContract({
        address: CONTRACTS.botRegistry as `0x${string}`,
        abi: BOT_REGISTRY_ABI,
        functionName: 'registerBot',
        args: [botId32, '0x0000000000000000000000000000000000000000' as `0x${string}`],
        value: parseEther('0.01'),
      });
    } catch (e: any) {
      setRegStatus('Error: ' + e.message);
    }
  };

  // Sell: approve NFT → list on marketplace
  const handleSell = async () => {
    if (!isConnected || !address) { setSellStatus('Please connect wallet first'); return; }
    if (!sellBot || !sellPrice) return;
    const priceNum = parseFloat(sellPrice);
    if (isNaN(priceNum) || priceNum <= 0) return alert('Enter a valid price');
    setSellBusy(true);
    setSellStatus('Looking up NFT tokenId...');
    try {
      const botIdHex = nameToBytes32(sellBot.botId);
      // Get tokenId from NFT contract
      const tokenId = await publicClient.readContract({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'botToTokenId',
        args: [botIdHex],
      });
      if (!tokenId || tokenId === 0n) {
        setSellStatus('This bot has no NFT. Register it first.');
        setSellBusy(false);
        return;
      }

      // Step 1: Approve marketplace
      setSellStatus('1/2 Approving marketplace...');
      const approveTx = await writeContractAsync({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'approve',
        args: [CONTRACTS.botMarketplace as `0x${string}`, tokenId],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });

      // Step 2: List on marketplace
      setSellStatus('2/2 Listing on marketplace...');
      const priceWei = parseEther(sellPrice);
      const listTx = await writeContractAsync({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'list',
        args: [tokenId, priceWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: listTx as `0x${string}` });

      setSellStatus('Listed! Your bot is now on the marketplace.');
      setTimeout(() => { setSellBot(null); setSellPrice(''); setSellStatus(''); }, 2000);
    } catch (e: any) {
      setSellStatus(e?.shortMessage || e?.message || 'Transaction failed');
    }
    setSellBusy(false);
  };

  useEffect(() => {
    if (regConfirming) setRegStatus('Confirming on-chain...');
    if (regConfirmed && regHash) {
      setRegStatus('Registered on-chain! NFT minted.');
      setNewName('');
    }
    if (regError) setRegStatus('⚠️ ' + regError.message);
  }, [regConfirming, regConfirmed, regHash, regError]);

  return (
    <div className="panel-card" style={{ maxHeight: '400px', overflowY: 'auto' }}>
      <div style={{ marginBottom: '6px', color: '#fff', fontSize: '0.85rem' }}>
        Bot Guide (click to copy URL):
      </div>
      <div
        className="copy-box"
        onClick={handleCopy}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleCopy()}
        style={{
          cursor: 'pointer', padding: '10px 12px', background: '#0d0d20',
          border: '1px solid var(--neon-blue)', borderRadius: '6px',
          fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--neon-green)',
          position: 'relative', userSelect: 'all',
          wordBreak: 'break-all' as const, lineHeight: '1.4',
        }}
      >
        📋 {guideUrl}
        {copied && (
          <span style={{
            position: 'absolute', right: 8, top: '-28px',
            background: 'var(--neon-green)', color: '#000', padding: '3px 10px', borderRadius: '4px',
            fontSize: '0.75rem', fontWeight: 'bold', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,255,136,0.4)', zIndex: 10,
          }}>Copied!</span>
        )}
      </div>

      {/* Bot List */}
      <div style={{ marginTop: '10px' }}>
        {bots.length === 0 && (
          <div style={{
            padding: '6px 8px', marginBottom: '4px', borderRadius: '6px',
            background: 'rgba(255,255,255,0.03)', border: '1px dashed #2a2a3a',
            color: '#555', fontSize: '0.8rem', textAlign: 'center',
          }}>
            No bots yet — register one below
          </div>
        )}
        {bots.map((bot, i) => (
          <div key={bot.botId || i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 8px', marginBottom: '4px', borderRadius: '6px',
            background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.3)',
          }}>
            <span style={{ color: 'var(--neon-green)', fontWeight: 'bold', fontSize: '0.85rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🤖 {bot.name}
            </span>
            <div style={{ display: 'flex', gap: '4px', marginLeft: '6px', flexShrink: 0 }}>
              <button type="button" onClick={() => handleEditOpen(bot)}
                style={{ padding: '2px 6px', fontSize: '0.65rem', background: '#1a1a2e', color: '#aaa', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer' }}>
                Edit
              </button>
              <button type="button" onClick={() => { setSellBot(bot); setSellPrice(''); setSellStatus(''); }}
                style={{ padding: '2px 6px', fontSize: '0.65rem', background: '#1a1a2e', color: 'var(--neon-pink)', border: '1px solid rgba(255,0,128,0.3)', borderRadius: '4px', cursor: 'pointer' }}>
                Sell
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {editBot && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget && !editBusy) { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); } }}
        >
          <div style={{
            background: '#0d0d20', border: '1px solid var(--neon-green)', borderRadius: '10px',
            padding: '16px', width: '90%', maxWidth: '600px', maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, color: 'var(--neon-green)', fontSize: '1rem' }}>
                Edit: {editBot.name}
              </h3>
              <button
                onClick={() => { if (!editBusy) { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); } }}
                style={{ background: '#333', color: '#aaa', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
              >X</button>
            </div>
            {editStatus && (
              <div style={{ padding: '6px 8px', marginBottom: '8px', borderRadius: '4px', background: 'rgba(255,255,255,0.05)', color: '#ccc', fontSize: '0.8rem' }}>
                {editStatus}
              </div>
            )}
            {editToken && (
              <>
                <textarea
                  value={editCode}
                  onChange={e => setEditCode(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1, minHeight: '300px', fontFamily: 'monospace', fontSize: '0.8rem',
                    background: '#000', color: '#0f0', border: '1px solid #333', borderRadius: '6px',
                    padding: '10px', resize: 'vertical', lineHeight: '1.5',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleEditSave}
                    disabled={editBusy}
                    style={{ padding: '6px 16px', fontSize: '0.8rem', background: 'var(--neon-green)', color: '#000', fontWeight: 'bold' }}
                  >
                    {editBusy ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); }}
                    disabled={editBusy}
                    style={{ padding: '6px 16px', fontSize: '0.8rem', background: '#333', color: '#aaa' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {sellBot && (
        <div style={{
          marginTop: '8px', padding: '10px', background: 'rgba(255,0,128,0.08)',
          border: '1px solid rgba(255,0,128,0.3)', borderRadius: '6px',
        }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--neon-pink)', marginBottom: '6px' }}>
            Sell: <strong>{sellBot.name}</strong>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input
              placeholder="Price (ETH)"
              value={sellPrice}
              onChange={e => setSellPrice(e.target.value)}
              type="number" min="0.001" step="0.001"
              style={{ flex: 1, fontSize: '0.8rem' }}
            />
            <button onClick={handleSell} disabled={sellBusy}
              style={{ padding: '4px 10px', fontSize: '0.7rem', background: 'var(--neon-pink)', color: '#fff', whiteSpace: 'nowrap' }}>
              {sellBusy ? '...' : 'List'}
            </button>
            <button onClick={() => setSellBot(null)} disabled={sellBusy}
              style={{ padding: '4px 8px', fontSize: '0.7rem', background: '#333', color: '#aaa' }}>
              X
            </button>
          </div>
          {sellStatus && <div className="muted" style={{ marginTop: '4px', fontSize: '0.75rem' }}>{sellStatus}</div>}
        </div>
      )}

      {(
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
          <input placeholder="Bot Name" value={newName} onChange={e => setNewName(e.target.value.replace(/[^a-zA-Z0-9_\- ]/g, '').slice(0, 24))} maxLength={24} style={{ flex: 1 }} />
          <button
            onClick={handleRegister}
            disabled={regPending || regConfirming}
            style={{
              width: 'auto', padding: '8px 12px', margin: 0,
              background: 'var(--neon-pink)', fontSize: '0.75rem', whiteSpace: 'nowrap'
            }}
          >
            {regPending ? '...' : regConfirming ? '⏳' : '💎 Register 0.01E'}
          </button>
        </div>
      )}
      {regStatus && <div className="muted" style={{ marginTop: '4px' }}>{regStatus}</div>}
    </div>
  );
}

// Prediction — server-side recording (on-chain PariMutuel disabled: contract reverts)
function Prediction({ displayMatchId, epoch, arenaType }: { displayMatchId: string | null; epoch: number; arenaType: 'performance' | 'competitive' }) {
  const { isConnected, address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [botName, setBotName] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (displayMatchId) setTargetMatch(displayMatchId);
  }, [displayMatchId]);

  const handlePredict = async () => {
    const input = targetMatch.trim().toUpperCase();
    if (!/^[PA]\d+$/.test(input)) return alert('请输入比赛编号，如 P5 或 A3');
    let mid: number;
    try {
      const r = await fetch('/api/match/by-display-id?id=' + encodeURIComponent(input));
      if (!r.ok) return alert('无法找到比赛 ' + input);
      const d = await r.json();
      mid = d.matchId;
    } catch { return alert('查询比赛编号失败'); }
    if (isNaN(mid)) return alert('无法解析比赛编号');
    if (!botName) return alert('请输入机器人名称');
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return alert('请输入 USDC 下注金额');
    if (!isConnected || !address) return alert('请先连接钱包');

    setBusy(true);
    try {
      // Convert bot name to bytes32
      const botIdHex = padHex(stringToHex(botName, { size: 32 }), { size: 32 });
      // USDC has 6 decimals
      const usdcAmount = parseUnits(amount, 6);

      // Step 1: Approve USDC
      setStatus('1/2 授权 USDC...');
      const approveTxHash = await writeContractAsync({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.pariMutuel as `0x${string}`, usdcAmount],
      });
      setStatus('1/2 等待授权确认...');
      if (approveTxHash) {
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash as `0x${string}` });
      }

      // Step 2: Place bet on-chain
      setStatus('2/2 链上下注...');
      const betTx = await writeContractAsync({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'placeBet',
        args: [BigInt(mid), botIdHex, usdcAmount],
      });

      // Record on server too (for leaderboard / tracking)
      await fetch('/api/bet/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: mid, botId: botName, amount, bettor: address, txHash: betTx, arenaType })
      });

      setStatus(`✅ 下注成功！${amount} USDC 押 ${botName} 赢`);
      setAmount('');
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || '交易失败';
      setStatus('❌ ' + msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>当前比赛</span><span>{displayMatchId ? `Epoch ${epoch} #${displayMatchId}` : '--'}</span></div>
      <input placeholder="比赛编号 (如 P5, A3)" value={targetMatch} onChange={e => setTargetMatch(e.target.value)} />
      <input placeholder="机器人名称 (预测谁赢?)" value={botName} onChange={e => setBotName(e.target.value)} style={{ marginTop: '6px' }} />
      <input placeholder="下注金额 (USDC)" value={amount} onChange={e => setAmount(e.target.value)} type="number" min="0.01" step="0.01" style={{ marginTop: '6px' }} />
      <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
        {['1', '5', '10'].map(v => (
          <button key={v} onClick={() => setAmount(v)} type="button"
            style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: amount === v ? 'var(--neon-green)' : '#1a1a2e', color: amount === v ? '#000' : '#aaa' }}>
            {v} USDC
          </button>
        ))}
      </div>
      <button onClick={handlePredict} disabled={busy} style={{ marginTop: '6px' }}>
        {busy ? '⏳ ' + status : '🔮 USDC 下注'}
      </button>
      {!busy && status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

function CompetitiveEnter({ displayMatchId }: { displayMatchId: string | null }) {
  const { isConnected } = useAccount();
  const [botName, setBotName] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [status, setStatus] = useState('');
  const [resolvedBotId, setResolvedBotId] = useState('');
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isConfirmed && hash && resolvedBotId) {
      setStatus('⏳ Confirming entry...');
      fetch('/api/competitive/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: resolvedBotId, displayMatchId: targetMatch, txHash: hash })
      }).then(r => r.json()).then(data => {
        setStatus(data.ok ? '✅ Entry confirmed for match ' + targetMatch : '⚠️ ' + (data.error || data.message || 'Failed'));
      }).catch(() => setStatus('⚠️ Network Error'));
    }
  }, [isConfirmed, hash, resolvedBotId, targetMatch]);

  const handleEnter = async () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!botName) return alert('Enter Bot Name');
    if (!targetMatch) return alert('Enter target match (e.g. A3)');

    try {
      setStatus('Looking up bot...');
      const res = await fetch('/api/bot/lookup?name=' + encodeURIComponent(botName));
      if (!res.ok) {
        const err = await res.json();
        setStatus('⚠️ ' + (err.error === 'bot_not_found' ? 'Bot "' + botName + '" not found' : err.error));
        return;
      }
      const data = await res.json();
      setResolvedBotId(data.botId);

      // Pay entry fee (0.001 ETH) via direct transfer to BotRegistry
      writeContract({
        address: CONTRACTS.botRegistry as `0x${string}`,
        abi: [{ inputs: [], name: 'payEntryFee', outputs: [], stateMutability: 'payable', type: 'function' }] as const,
        functionName: 'payEntryFee',
        value: parseEther('0.001'),
      });
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Current Match</span><span>{displayMatchId || '--'}</span></div>
      <input placeholder="Bot Name" value={botName} onChange={e => setBotName(e.target.value)} />
      <input
        placeholder={`Target Match (e.g. A${displayMatchId ? parseInt(displayMatchId.replace(/\D/g, '')) + 1 : '?'})`}
        value={targetMatch}
        onChange={e => setTargetMatch(e.target.value)}
        style={{ marginTop: '6px' }}
      />
      <div className="muted" style={{ marginTop: '4px' }}>Cost: 0.001 ETH per entry</div>
      <button onClick={handleEnter} disabled={isPending || isConfirming} style={{ marginTop: '6px' }}>
        {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : '🎯 Enter Arena'}
      </button>
      {status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

// Issue 4 & 5: GameCanvas with displayMatchId and epoch
function GameCanvas({
  mode,
  setMatchId,
  setPlayers,
  setDisplayMatchId,
  setEpoch,
}: {
  mode: 'performance' | 'competitive';
  setMatchId: (id: number | null) => void;
  setPlayers: (players: any[]) => void;
  setDisplayMatchId: (id: string | null) => void;
  setEpoch: (n: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foodImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = foodSvgUrl;
    img.onload = () => { foodImgRef.current = img; };
  }, []);
  const [status, setStatus] = useState('Connecting...');
  const [overlay, setOverlay] = useState<React.ReactNode>(null);
  const [timer, setTimer] = useState('3:00');
  const [timerColor, setTimerColor] = useState('#ff8800');
  const [matchInfo, setMatchInfo] = useState('ARENA: --');
  const [selectedRoom, setSelectedRoom] = useState(1);
  const [roomCount, setRoomCount] = useState(1);

  const isCompetitive = mode === 'competitive';

  useEffect(() => {
    if (isCompetitive) return;
    const fetchRooms = async () => {
      try {
        const res = await fetch('/api/arena/status');
        const data = await res.json();
        setRoomCount(data.performance?.length || 1);
      } catch (e) { console.error(e); }
    };
    fetchRooms();
    const t = setInterval(fetchRooms, 5000);
    return () => clearInterval(t);
  }, [isCompetitive]);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const arenaId = isCompetitive ? 'competitive-1' : `performance-${selectedRoom}`;
    const wsUrl = `${proto}://${window.location.host}?arenaId=${arenaId}`;

    let ws: WebSocket;
    let reconnectDelay = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const connect = () => {
        if (destroyed) return;
        ws = new WebSocket(wsUrl);
        ws.onopen = () => { setStatus('Connected!'); reconnectDelay = 1000; };
        ws.onclose = () => {
            setStatus('Disconnected — reconnecting...');
            if (!destroyed) {
                reconnectTimer = setTimeout(() => {
                    reconnectDelay = Math.min(reconnectDelay * 2, 16000);
                    connect();
                }, reconnectDelay);
            }
        };
        ws.onerror = () => {}; // onclose will fire after this
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'update') render(msg.state);
            } catch (e) { console.error(e); }
        };
    };

    connect();

    const render = (state: any) => {
        setMatchId(state.matchId);
        setDisplayMatchId(state.displayMatchId || null);
        if (state.epoch) setEpoch(state.epoch);

        // Issue 5: Show "Epoch X #displayMatchId"
        const epochStr = state.epoch ? `Epoch ${state.epoch}` : '';
        const matchStr = state.displayMatchId || `#${state.matchId || '?'}`;
        setMatchInfo(`${isCompetitive ? '⚔️ ' : ''}${epochStr} ${matchStr}`);

        const alivePlayers = state.players || [];
        const waitingPlayers = (state.waitingPlayers || []).map((p: any) => ({ ...p, waiting: true }));
        setPlayers([...alivePlayers, ...waitingPlayers]);

        if (state.gameState === 'PLAYING') {
            const min = Math.floor(state.matchTimeLeft/60);
            const sec = state.matchTimeLeft%60;
            setTimer(`${min}:${sec.toString().padStart(2,'0')}`);
            setTimerColor(state.matchTimeLeft < 30 ? '#ff3333' : '#ff8800');
            setOverlay(null);
        } else if (state.gameState === 'COUNTDOWN') {
            setTimer(`Starting in ${state.timeLeft}s`);
            setTimerColor('#00ff88');
            setOverlay(<div className="overlay-text">GET READY!</div>);
        } else if (state.gameState === 'GAMEOVER') {
            setTimer(`Next in ${state.timeLeft}s`);
            setTimerColor('#888');
            setOverlay(<>
                <div className="overlay-text">🏆</div>
                <div className="overlay-text">{state.winner || 'NO WINNER'}</div>
            </>);
        } else if (state.victoryPause) {
            const winner = state.players.find((p: any) => p.alive);
            setOverlay(<>
                <div className="overlay-text">🏆</div>
                <div className="overlay-text">{winner ? winner.name : ''} WINS!</div>
            </>);
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const cellSize = canvas.width / 30;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = isCompetitive ? '#1a1020' : '#1a1a2e';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 30; i++) {
            ctx.beginPath(); ctx.moveTo(i*cellSize, 0); ctx.lineTo(i*cellSize, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i*cellSize); ctx.lineTo(canvas.width, i*cellSize); ctx.stroke();
        }

        if (state.obstacles && state.obstacles.length > 0) {
            for (const obs of state.obstacles) {
                if (obs.solid) {
                    ctx.fillStyle = '#8b0000';
                    ctx.shadowColor = '#ff0000';
                    ctx.shadowBlur = 4;
                    ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = '#ff4444';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(obs.x * cellSize + 2, obs.y * cellSize + 2);
                    ctx.lineTo((obs.x + 1) * cellSize - 2, (obs.y + 1) * cellSize - 2);
                    ctx.moveTo((obs.x + 1) * cellSize - 2, obs.y * cellSize + 2);
                    ctx.lineTo(obs.x * cellSize + 2, (obs.y + 1) * cellSize - 2);
                    ctx.stroke();
                } else {
                    const blink = Math.floor(Date.now() / 200) % 2 === 0;
                    if (blink) {
                        ctx.fillStyle = 'rgba(255, 200, 0, 0.6)';
                        ctx.shadowColor = '#ffcc00';
                        ctx.shadowBlur = 8;
                        ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                        ctx.shadowBlur = 0;
                    } else {
                        ctx.fillStyle = 'rgba(255, 200, 0, 0.2)';
                        ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                    }
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                }
            }
        }

        state.food.forEach((f: any) => {
            if (foodImgRef.current) {
                const pad = cellSize * 0.1;
                ctx.drawImage(foodImgRef.current, f.x * cellSize + pad, f.y * cellSize + pad, cellSize - pad * 2, cellSize - pad * 2);
            } else {
                ctx.fillStyle = '#ff0055';
                ctx.shadowColor = '#ff0055'; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(f.x*cellSize+cellSize/2, f.y*cellSize+cellSize/2, cellSize/3, 0, Math.PI*2); ctx.fill();
                ctx.shadowBlur = 0;
            }
        });

        (state.players || []).forEach((p: any) => {
            if (!p.body || p.body.length === 0) return;

            const isBlinking = !p.alive && p.blinking;
            if (isBlinking && Math.floor(Date.now() / 500) % 2 === 0) return;

            ctx.fillStyle = p.color || '#00ff88';
            ctx.shadowColor = p.color || '#00ff88';
            ctx.shadowBlur = p.alive ? 8 : 0;
            ctx.globalAlpha = p.alive ? 1 : 0.4;

            const pName = p.name || '';
            p.body.forEach((seg: any, i: number) => {
                if (i === 0) return;
                ctx.fillRect(seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2);
                const letterIdx = i - 1;
                if (letterIdx < pName.length && pName[letterIdx]) {
                    ctx.save();
                    ctx.fillStyle = '#000';
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = p.alive ? 0.8 : 0.3;
                    ctx.font = `bold ${Math.max(cellSize * 0.6, 8)}px Orbitron, monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(pName[letterIdx], seg.x * cellSize + cellSize/2, seg.y * cellSize + cellSize/2 + 1);
                    ctx.restore();
                    ctx.fillStyle = p.color || '#00ff88';
                    ctx.shadowColor = p.color || '#00ff88';
                    ctx.shadowBlur = p.alive ? 8 : 0;
                    ctx.globalAlpha = p.alive ? 1 : 0.4;
                }
            });

            const head = p.body[0];
            const dir = p.direction || {x:1, y:0};
            const cx = head.x * cellSize + cellSize/2;
            const cy = head.y * cellSize + cellSize/2;
            const size = cellSize/2 - 1;

            ctx.beginPath();
            if (dir.x === 1) { ctx.moveTo(cx+size,cy); ctx.lineTo(cx-size,cy-size); ctx.lineTo(cx-size,cy+size); }
            else if (dir.x === -1) { ctx.moveTo(cx-size,cy); ctx.lineTo(cx+size,cy-size); ctx.lineTo(cx+size,cy+size); }
            else if (dir.y === -1) { ctx.moveTo(cx,cy-size); ctx.lineTo(cx-size,cy+size); ctx.lineTo(cx+size,cy+size); }
            else { ctx.moveTo(cx,cy+size); ctx.lineTo(cx-size,cy-size); ctx.lineTo(cx+size,cy-size); }
            ctx.closePath();
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    };

    return () => { destroyed = true; if (reconnectTimer) clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, [setMatchId, setPlayers, selectedRoom, isCompetitive, setDisplayMatchId, setEpoch]);

  const borderColor = isCompetitive ? 'var(--neon-pink)' : 'var(--neon-blue)';

  return (
    <div className="main-stage">
        {isCompetitive ? (
          <h1 style={{ color: 'var(--neon-pink)', textShadow: '0 0 10px rgba(255,0,85,0.5)' }}>⚔️ COMPETITIVE ARENA</h1>
        ) : (
          <h1>🦀 SNAKE ARENA {selectedRoom}
            <span className="room-selector">
              {[1,2,3,4,5,6].map(n => (
                <button
                  key={n}
                  className={`room-btn ${selectedRoom === n ? 'active' : ''} ${n > roomCount ? 'disabled' : ''}`}
                  onClick={() => n <= roomCount && setSelectedRoom(n)}
                  disabled={n > roomCount}
                >{n}</button>
              ))}
            </span>
          </h1>
        )}
        <div className="match-info">{matchInfo}</div>
        <div className="timer" style={{ color: timerColor }}>{timer}</div>
        <div className="canvas-wrap">
          <canvas ref={canvasRef} width={600} height={600} style={{ border: `4px solid ${borderColor}`, background: '#000', maxWidth: '90%', maxHeight: '70vh' }}></canvas>
          <div id="overlay">{overlay}</div>
        </div>
        <div className="status-bar">{status}</div>
        <div className="rules-wrap">
          <h3>📜 {isCompetitive ? '竞技场规则' : '游戏规则'}</h3>
          <div className="rules-box">{isCompetitive ? COMPETITIVE_RULES : PERFORMANCE_RULES}</div>
        </div>
    </div>
  );
}

// Airdrop points type labels (Chinese)
const AIRDROP_TYPE_LABELS: Record<string, string> = {
  register: '注册奖励',
  checkin: '每日签到',
  match_participate: '参赛奖励',
  match_place: '名次奖励',
  bet_activity: '下注参与',
  bet_win: '下注赢利',
  referral_l1: '邀请奖励 L1',
  referral_l2: '邀请奖励 L2',
};

// Full-page Points view — now shows Airdrop Points + Betting Balance
function PointsPage() {
  const { address } = useAccount();
  const [myAirdrop, setMyAirdrop] = useState<any>(null);
  const [myBalance, setMyBalance] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [checkinStatus, setCheckinStatus] = useState('');
  const [checkinBusy, setCheckinBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [adRes, balRes, lbRes] = await Promise.all([
          address ? fetch('/api/airdrop/my?address=' + address) : Promise.resolve(null),
          address ? fetch('/api/points/my?address=' + address) : Promise.resolve(null),
          fetch('/api/airdrop/leaderboard'),
        ]);
        if (adRes && adRes.ok) setMyAirdrop(await adRes.json());
        if (balRes && balRes.ok) setMyBalance(await balRes.json());
        if (lbRes.ok) setLeaderboard(await lbRes.json());
      } catch (e) { console.error(e); }
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [address]);

  const handleCheckin = async () => {
    if (!address) return;
    setCheckinBusy(true);
    setCheckinStatus('Signing...');
    try {
      // Request wallet signature
      const timestamp = Date.now().toString();
      const message = `SnakeArena Checkin\nAddress: ${address}\nTimestamp: ${timestamp}`;
      const provider = (window as any).ethereum;
      if (!provider) { setCheckinStatus('No wallet found'); setCheckinBusy(false); return; }
      const { BrowserProvider } = await import('ethers');
      const ethProvider = new BrowserProvider(provider);
      const signer = await ethProvider.getSigner();
      const signature = await signer.signMessage(message);

      const res = await fetch('/api/airdrop/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, timestamp }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCheckinStatus(`+${data.points} pts! ${data.message}`);
        // Refresh data
        const adRes = await fetch('/api/airdrop/my?address=' + address);
        if (adRes.ok) setMyAirdrop(await adRes.json());
      } else {
        setCheckinStatus(data.message || data.error || 'Failed');
      }
    } catch (e: any) {
      setCheckinStatus(e?.shortMessage || e?.message || 'Error');
    }
    setCheckinBusy(false);
  };

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '20px' }}>Airdrop Points</h2>

      {/* Airdrop Points Card */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        <h3>My Airdrop Points</h3>
        {!address ? (
          <div className="panel-card muted">Connect wallet to see your points</div>
        ) : !myAirdrop ? (
          <div className="panel-card muted">Loading...</div>
        ) : (
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--neon-green)' }}>{myAirdrop.total || 0}</div>
                <div className="muted">Airdrop Points</div>
              </div>
              {myAirdrop.rank && (
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--neon-blue)' }}>#{myAirdrop.rank}</div>
                  <div className="muted">Rank</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ff8800' }}>{myAirdrop.checkin?.streak || 0}</div>
                <div className="muted">Streak</div>
              </div>
            </div>

            {/* Check-in Button */}
            <div style={{ textAlign: 'center', marginBottom: '12px' }}>
              <button
                onClick={handleCheckin}
                disabled={checkinBusy || !(myAirdrop.checkin?.canCheckin)}
                style={{
                  padding: '10px 24px', fontSize: '1rem', fontWeight: 'bold',
                  background: myAirdrop.checkin?.canCheckin ? 'var(--neon-green)' : '#333',
                  color: myAirdrop.checkin?.canCheckin ? '#000' : '#666',
                  border: 'none', borderRadius: '8px', cursor: myAirdrop.checkin?.canCheckin ? 'pointer' : 'default',
                }}
              >
                {checkinBusy ? 'Signing...' : myAirdrop.checkin?.canCheckin ? 'Daily Check-in (+10 pts)' : 'Checked in today'}
              </button>
              {checkinStatus && <div className="muted" style={{ marginTop: '6px' }}>{checkinStatus}</div>}
            </div>

            {/* Betting Balance */}
            {myBalance && (
              <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,136,255,0.1)', borderRadius: '6px', marginBottom: '12px' }}>
                <span className="muted">Betting Balance: </span>
                <span style={{ color: 'var(--neon-blue)', fontWeight: 'bold' }}>{myBalance.points || 0} pts</span>
              </div>
            )}

            {/* Points breakdown */}
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', textAlign: 'center' }}>
              Airdrop points are accumulate-only (never decrease). Betting balance is separate.
            </div>

            {myAirdrop.history && myAirdrop.history.length > 0 && (
              <>
                <h4 style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '6px' }}>Recent Activity</h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {myAirdrop.history.map((h: any, i: number) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '4px 8px',
                      borderBottom: '1px solid #1b1b2b', fontSize: '0.8rem',
                    }}>
                      <span className="muted">{AIRDROP_TYPE_LABELS[h.type] || h.type}</span>
                      <span style={{ color: 'var(--neon-green)' }}>+{h.points}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Airdrop Points Rules */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        <h3>How to Earn Points</h3>
        <div className="panel-card" style={{ fontSize: '0.82rem', lineHeight: '1.7' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 16px' }}>
            <span>Register a bot</span><span style={{ color: 'var(--neon-green)' }}>+200</span>
            <span>Daily check-in (day 1-6)</span><span style={{ color: 'var(--neon-green)' }}>+10</span>
            <span>7-day streak bonus</span><span style={{ color: 'var(--neon-green)' }}>+30</span>
            <span>Bot participates in match</span><span style={{ color: 'var(--neon-green)' }}>+5</span>
            <span>1st / 2nd / 3rd place</span><span style={{ color: 'var(--neon-green)' }}>+50 / +30 / +20</span>
            <span>Place a bet</span><span style={{ color: 'var(--neon-green)' }}>+5</span>
            <span>Win a bet</span><span style={{ color: 'var(--neon-green)' }}>profit x 0.5</span>
            <span>Invite L1 / L2</span><span style={{ color: 'var(--neon-green)' }}>+100 / +50</span>
          </div>
        </div>
      </div>

      {/* Airdrop Leaderboard */}
      <div className="panel-section">
        <h3>Airdrop Leaderboard (Top 50)</h3>
        <ul className="fighter-list">
          {leaderboard.map((p: any, i: number) => (
            <li key={i} className="fighter-item alive">
              <span className="fighter-name">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}{' '}
                {p.address ? (p.address.slice(0, 6) + '...' + p.address.slice(-4)) : 'unknown'}
              </span>
              <span className="fighter-length" style={{ color: 'var(--neon-green)' }}>{p.total || 0} pts</span>
            </li>
          ))}
          {leaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
        </ul>
      </div>
    </div>
  );
}

// Full-page Marketplace view — reads from BotMarketplace escrow contract
function MarketplacePage() {
  const { isConnected, address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [actionStatus, setActionStatus] = useState('');

  const loadListings = async () => {
    try {
      const res = await fetch('/api/marketplace/listings?offset=0&limit=50');
      if (res.ok) {
        const data = await res.json();
        setListings(data.listings || []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => {
    loadListings();
    const t = setInterval(loadListings, 30000);
    return () => clearInterval(t);
  }, []);

  const handleBuy = async (item: any) => {
    if (!isConnected || !address) return alert('Please connect wallet first');
    const tokenId = item.tokenId;
    const priceWei = item.priceWei;
    if (!priceWei || priceWei === '0') return alert('Invalid price');
    setActionId(tokenId);
    setActionStatus('Signing transaction...');
    try {
      const txHash = await writeContractAsync({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'buy',
        args: [BigInt(tokenId)],
        value: BigInt(priceWei),
      });
      setActionStatus('Confirming...');
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      setActionStatus('Purchased! Updating ownership...');
      // Notify server to update local ownership based on NFT
      if (item.botId) {
        await fetch('/api/bot/claim-nft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId: item.botId, address, txHash }),
        });
      }
      setActionStatus('Done!');
      await loadListings();
    } catch (e: any) {
      setActionStatus(e?.shortMessage || e?.message || 'Transaction failed');
    }
    setTimeout(() => { setActionId(null); setActionStatus(''); }, 3000);
  };

  const handleCancel = async (item: any) => {
    if (!isConnected) return alert('Connect wallet first');
    setActionId(item.tokenId);
    setActionStatus('Cancelling...');
    try {
      const txHash = await writeContractAsync({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'cancel',
        args: [BigInt(item.tokenId)],
      });
      setActionStatus('Confirming...');
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
      setActionStatus('Cancelled! NFT returned.');
      await loadListings();
    } catch (e: any) {
      setActionStatus(e?.shortMessage || e?.message || 'Cancel failed');
    }
    setTimeout(() => { setActionId(null); setActionStatus(''); }, 3000);
  };

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-pink)', textAlign: 'center', marginBottom: '20px' }}>🏪 Bot Marketplace</h2>
      <div className="muted" style={{ textAlign: 'center', marginBottom: '16px', fontSize: '0.8rem' }}>
        NFT escrow marketplace — bots are held in contract until sold or cancelled. 2.5% fee.
      </div>

      <div className="panel-section">
        {loading ? (
          <div className="panel-card muted">Loading marketplace...</div>
        ) : listings.length === 0 ? (
          <div className="panel-card">
            <div className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🏪</div>
              <p>No bots are currently listed for sale.</p>
              <p style={{ fontSize: '0.8rem', marginTop: '8px' }}>
                List your bot from the "My Bots" panel using the Sell button.
              </p>
            </div>
          </div>
        ) : (
          <div>
            {listings.map((item, i) => {
              const isSeller = address && item.seller && item.seller.toLowerCase() === address.toLowerCase();
              return (
                <div key={i} className="panel-card" style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{item.botName || `Token #${item.tokenId}`}</div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        Seller: {item.seller ? (item.seller.slice(0, 6) + '...' + item.seller.slice(-4)) : 'unknown'}
                        {item.matchesPlayed ? ` | ${item.matchesPlayed} matches` : ''}
                        {item.botId ? ` | ID: ${item.botId}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ color: 'var(--neon-pink)', fontWeight: 'bold', fontSize: '1.1rem' }}>{item.price} ETH</div>
                      {isConnected && (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', marginTop: '4px' }}>
                          {isSeller ? (
                            <button
                              onClick={() => handleCancel(item)}
                              disabled={actionId === item.tokenId}
                              style={{ fontSize: '0.75rem', padding: '4px 12px', background: '#333', color: '#ff8800' }}
                            >
                              {actionId === item.tokenId ? (actionStatus || '...') : 'Cancel'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBuy(item)}
                              disabled={actionId === item.tokenId}
                              style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                            >
                              {actionId === item.tokenId ? (actionStatus || '...') : `Buy (${item.price} ETH)`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {actionStatus && actionId !== null && <div className="muted" style={{ textAlign: 'center', marginTop: '8px' }}>{actionStatus}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [, setMatchId] = useState<number | null>(null);
  const [displayMatchId, setDisplayMatchId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(1);
  const [players, setPlayers] = useState<any[]>([]);
  const [perfLeaderboard, setPerfLeaderboard] = useState<any[]>([]);
  const [compLeaderboard, setCompLeaderboard] = useState<any[]>([]);
  const [activePage, setActivePage] = useState<'performance' | 'competitive' | 'leaderboard' | 'points' | 'marketplace'>('performance');

  const playersRef = useRef<any[]>([]);
  const lastPlayersUpdate = useRef(0);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttledSetPlayers = useRef((p: any[]) => {
    playersRef.current = p;
    const now = Date.now();
    if (now - lastPlayersUpdate.current > 500) {
      lastPlayersUpdate.current = now;
      setPlayers(p);
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
    } else {
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
      trailingTimer.current = setTimeout(() => {
        lastPlayersUpdate.current = Date.now();
        setPlayers(playersRef.current);
      }, 500);
    }
  }).current;

  const matchIdRef = useRef<number | null>(null);
  const throttledSetMatchId = useRef((id: number | null) => {
    if (matchIdRef.current !== id) {
      matchIdRef.current = id;
      setMatchId(id);
    }
  }).current;

  useEffect(() => {
    const load = async () => {
      try {
        const [perfRes, compRes] = await Promise.all([
          fetch('/api/leaderboard/performance'),
          fetch('/api/leaderboard/competitive'),
        ]);
        if (perfRes.ok) setPerfLeaderboard(await perfRes.json());
        if (compRes.ok) setCompLeaderboard(await compRes.json());
      } catch (_e) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const isCompetitive = activePage === 'competitive';

  const switchPage = (page: typeof activePage) => {
    setPlayers([]);
    setMatchId(null);
    setDisplayMatchId(null);
    setActivePage(page);
  };

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <div className="app">
            <header className="top-tabs">
              <button className={`tab ${activePage === 'performance' ? 'active' : ''}`} onClick={() => switchPage('performance')}>🦀 表演场</button>
              <button className={`tab tab-competitive ${activePage === 'competitive' ? 'active' : ''}`} onClick={() => switchPage('competitive')}>⚔️ 竞技场</button>
              <button className={`tab ${activePage === 'leaderboard' ? 'active' : ''}`} onClick={() => switchPage('leaderboard')}>🏆 排行榜</button>
              <button className={`tab ${activePage === 'points' ? 'active' : ''}`} onClick={() => switchPage('points')}>⭐ 积分</button>
              <button className={`tab ${activePage === 'marketplace' ? 'active' : ''}`} onClick={() => switchPage('marketplace')}>🏪 市场</button>
              <div style={{ marginLeft: 'auto' }}>
                <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
              </div>
            </header>

            {activePage === 'leaderboard' ? (
              <div className="leaderboard-page">
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', justifyContent: 'center', padding: '24px', width: '100%', maxWidth: '900px', margin: '0 auto' }}>
                  <div className="panel-section" style={{ flex: 1, minWidth: '280px' }}>
                    <h2 style={{ color: 'var(--neon-green)', textAlign: 'center' }}>🦀 Performance</h2>
                    <ul className="fighter-list">
                      {perfLeaderboard.map((p: any, i: number) => (
                        <li key={i} className="fighter-item alive">
                          <span className="fighter-name">
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}
                          </span>
                          <span className="fighter-length">{p.wins}W</span>
                        </li>
                      ))}
                      {perfLeaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
                    </ul>
                  </div>
                  <div className="panel-section" style={{ flex: 1, minWidth: '280px' }}>
                    <h2 style={{ color: 'var(--neon-pink)', textAlign: 'center' }}>⚔️ Competitive</h2>
                    <ul className="fighter-list">
                      {compLeaderboard.map((p: any, i: number) => (
                        <li key={i} className="fighter-item alive">
                          <span className="fighter-name">
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}
                          </span>
                          <span className="fighter-length">{p.wins}W</span>
                        </li>
                      ))}
                      {compLeaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
                    </ul>
                  </div>
                </div>
              </div>
            ) : activePage === 'points' ? (
              <PointsPage />
            ) : activePage === 'marketplace' ? (
              <MarketplacePage />
            ) : (
              <div className={`content`}>
                <aside className="left-panel">
                  <div className="panel-section">
                    <h3>🤖 Bot Management</h3>
                    <BotManagement />
                  </div>
                  {isCompetitive && (
                    <div className="panel-section">
                      <h3>🎯 Arena Entry</h3>
                      <CompetitiveEnter displayMatchId={displayMatchId} />
                    </div>
                  )}
                  <div className="panel-section">
                    <h3>🔮 Prediction</h3>
                    <Prediction displayMatchId={displayMatchId} epoch={epoch} arenaType={activePage as 'performance' | 'competitive'} />
                  </div>
                </aside>

                <GameCanvas
                  key={activePage}
                  mode={activePage as any}
                  setMatchId={throttledSetMatchId}
                  setPlayers={throttledSetPlayers}
                  setDisplayMatchId={setDisplayMatchId}
                  setEpoch={setEpoch}
                />

                <aside className="right-panel">
                  <div className="panel-section">
                    <h3>⚔️ Fighters</h3>
                    <ul className="fighter-list">
                      {[...players].sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0)).map((p, i) => (
                        <li key={i} className={`fighter-item ${p.waiting ? 'alive' : (p.alive ? 'alive' : 'dead')}`}>
                          <span className="fighter-name" style={{ color: p.color }}>{p.name}{p.waiting ? ' (waiting)' : ''}</span>
                          <span className="fighter-length">{p.body?.length || 0} {p.waiting ? '⏳' : (p.alive ? '🐍' : '💀')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="panel-section">
                      <h3>🏆 {isCompetitive ? 'Competitive' : 'Performance'} Leaderboard</h3>
                      <ul className="fighter-list">
                        {(isCompetitive ? compLeaderboard : perfLeaderboard).slice(0, 10).map((p: any, i: number) => (
                          <li key={i} className="fighter-item">
                            <span className="fighter-name">{p.name}</span>
                            <span className="fighter-length">{p.wins}W</span>
                          </li>
                        ))}
                      </ul>
                  </div>
                </aside>
              </div>
            )}
          </div>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
