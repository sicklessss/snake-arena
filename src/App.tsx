import React, { useState, useEffect, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useConnect, useDisconnect, useSignMessage, useSendTransaction, createConfig, http as wagmiHttp } from 'wagmi';
import { injected, metaMask, coinbaseWallet } from 'wagmi/connectors';
import { parseEther, parseUnits, stringToHex, padHex, createPublicClient, http } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import './index.css';
import { CONTRACTS, BOT_REGISTRY_ABI, PARI_MUTUEL_ABI, ERC20_ABI, BOT_MARKETPLACE_ABI, SNAKE_BOT_NFT_ABI } from './contracts';
import foodSvgUrl from './assets/food.svg';

// --- Shared canvas rendering function (used by GameCanvas + ReplayPage) ---
function renderFrame(
  ctx: CanvasRenderingContext2D,
  frame: { players?: any[]; food?: any[]; obstacles?: any[] },
  cellSize: number,
  canvasW: number,
  canvasH: number,
  foodImg: HTMLImageElement | null,
  opts?: { gridColor?: string }
) {
  const gridColor = opts?.gridColor || '#1a1a2e';

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 30; i++) {
    ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, canvasH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cellSize); ctx.lineTo(canvasW, i * cellSize); ctx.stroke();
  }

  if (frame.obstacles && frame.obstacles.length > 0) {
    for (const obs of frame.obstacles) {
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

  (frame.food || []).forEach((f: any) => {
    if (foodImg) {
      const pad = cellSize * 0.1;
      ctx.drawImage(foodImg, f.x * cellSize + pad, f.y * cellSize + pad, cellSize - pad * 2, cellSize - pad * 2);
    } else {
      ctx.fillStyle = '#ff0055';
      ctx.shadowColor = '#ff0055'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(f.x * cellSize + cellSize / 2, f.y * cellSize + cellSize / 2, cellSize / 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  });

  (frame.players || []).forEach((p: any) => {
    if (!p.body || p.body.length === 0) return;
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
        ctx.fillText(pName[letterIdx], seg.x * cellSize + cellSize / 2, seg.y * cellSize + cellSize / 2 + 1);
        ctx.restore();
        ctx.fillStyle = p.color || '#00ff88';
        ctx.shadowColor = p.color || '#00ff88';
        ctx.shadowBlur = p.alive ? 8 : 0;
        ctx.globalAlpha = p.alive ? 1 : 0.4;
      }
    });

    const head = p.body[0];
    const dir = p.direction || { x: 1, y: 0 };
    const cx = head.x * cellSize + cellSize / 2;
    const cy = head.y * cellSize + cellSize / 2;
    const size = cellSize / 2 - 1;

    ctx.beginPath();
    if (dir.x === 1) { ctx.moveTo(cx + size, cy); ctx.lineTo(cx - size, cy - size); ctx.lineTo(cx - size, cy + size); }
    else if (dir.x === -1) { ctx.moveTo(cx - size, cy); ctx.lineTo(cx + size, cy - size); ctx.lineTo(cx + size, cy + size); }
    else if (dir.y === -1) { ctx.moveTo(cx, cy - size); ctx.lineTo(cx - size, cy + size); ctx.lineTo(cx + size, cy + size); }
    else { ctx.moveTo(cx, cy + size); ctx.lineTo(cx - size, cy - size); ctx.lineTo(cx + size, cy - size); }
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  });
}

// --- CONFIG (multi-wallet, no WalletConnect dependency) ---
const config = createConfig({
  chains: [baseSepolia],
  connectors: [
    metaMask(),
    coinbaseWallet({ appName: 'Snake Arena' }),
    injected(),
  ],
  transports: { [baseSepolia.id]: wagmiHttp() },
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
  return stringToHex(name, { size: 32 });
}

// --- COMPONENTS ---

// Wallet icons (inline SVG data URIs)
const WALLET_ICONS: Record<string, string> = {
  metaMask: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#F6851B"/><text x="20" y="26" text-anchor="middle" font-size="20" fill="white">M</text></svg>'),
  coinbaseWallet: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#0052FF"/><text x="20" y="26" text-anchor="middle" font-size="20" fill="white">C</text></svg>'),
  injected: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#627EEA"/><text x="20" y="26" text-anchor="middle" font-size="20" fill="white">W</text></svg>'),
};

function getWalletIcon(id: string) {
  if (id.toLowerCase().includes('metamask')) return WALLET_ICONS.metaMask;
  if (id.toLowerCase().includes('coinbase')) return WALLET_ICONS.coinbaseWallet;
  return WALLET_ICONS.injected;
}

function getWalletDisplayName(connector: { id: string; name: string }) {
  if (connector.id.toLowerCase().includes('metamask') || connector.name.toLowerCase().includes('metamask')) return 'MetaMask';
  if (connector.id.toLowerCase().includes('coinbase') || connector.name.toLowerCase().includes('coinbase')) return 'Coinbase Wallet';
  if (connector.id === 'injected') return 'Browser Wallet';
  return connector.name;
}

// Wallet connection button + modal selector
function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [claimable, setClaimable] = useState<{ matchId: number; winnings: string; winningsWei: string }[]>([]);
  const [claimTotal, setClaimTotal] = useState('0');
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState('');

  // Fetch claimable winnings when menu opens
  useEffect(() => {
    if (!showMenu || !address) return;
    setClaimStatus('');
    fetch(`/api/pari-mutuel/claimable?address=${address}`)
      .then(r => r.json())
      .then(data => {
        setClaimable(data.claimable || []);
        setClaimTotal(data.total || '0');
      })
      .catch(() => { setClaimable([]); setClaimTotal('0'); });
  }, [showMenu, address]);

  const handleClaim = async () => {
    if (!claimable.length || claiming) return;
    setClaiming(true);
    setClaimStatus('Claiming...');
    let claimed = 0;
    for (const item of claimable) {
      try {
        await writeContractAsync({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(item.matchId)],
        });
        claimed++;
        setClaimStatus(`Claimed ${claimed}/${claimable.length}...`);
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || '';
        if (msg.includes('rejected') || msg.includes('denied')) {
          setClaimStatus('Cancelled');
          setClaiming(false);
          return;
        }
        // Skip this match, continue with others
        setClaimStatus(`Match #${item.matchId} failed, continuing...`);
      }
    }
    setClaiming(false);
    setClaimStatus(claimed > 0 ? `Claimed ${claimed} match(es)!` : 'No claims succeeded');
    // Refresh claimable list
    if (address) {
      fetch(`/api/pari-mutuel/claimable?address=${address}`)
        .then(r => r.json())
        .then(data => { setClaimable(data.claimable || []); setClaimTotal(data.total || '0'); })
        .catch(() => {});
    }
  };

  // De-duplicate connectors by display name
  const uniqueConnectors = connectors.reduce<typeof connectors>((acc, c) => {
    const name = getWalletDisplayName(c);
    if (!acc.find(x => getWalletDisplayName(x) === name)) acc.push(c);
    return acc;
  }, []);

  if (isConnected && address) {
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          style={{
            padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px',
            background: 'rgba(0,255,136,0.15)', color: 'var(--neon-green)',
            border: '1px solid var(--neon-green)', cursor: 'pointer',
            fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--neon-green)', display: 'inline-block' }} />
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
        {showMenu && (
          <>
            <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 6,
              background: '#0f0f25', border: '1px solid #2a2a4a', borderRadius: 10,
              padding: 8, minWidth: 180, zIndex: 9999,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}>
              <div style={{ padding: '6px 10px', fontSize: '0.75rem', color: 'var(--text-dim)', borderBottom: '1px solid #1b1b3b', marginBottom: 4 }}>
                Base Sepolia
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(address); setShowMenu(false); }}
                style={{
                  width: '100%', padding: '8px 10px', background: 'transparent', color: '#fff',
                  border: 'none', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                  fontSize: '0.75rem', textAlign: 'left', borderRadius: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Copy Address
              </button>
              {/* Claim USDC winnings section */}
              <div style={{ borderTop: '1px solid #1b1b3b', margin: '4px 0', padding: '6px 10px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>
                  Claimable: <span style={{ color: parseFloat(claimTotal) > 0 ? 'var(--neon-green)' : '#fff' }}>{claimTotal} USDC</span>
                </div>
                {parseFloat(claimTotal) > 0 && (
                  <button
                    onClick={handleClaim}
                    disabled={claiming}
                    style={{
                      width: '100%', padding: '6px 10px', borderRadius: 6,
                      background: claiming ? '#333' : 'var(--neon-green)',
                      color: claiming ? '#888' : '#000', border: 'none',
                      cursor: claiming ? 'not-allowed' : 'pointer',
                      fontFamily: 'Orbitron, monospace', fontSize: '0.7rem', fontWeight: 'bold',
                    }}
                  >
                    {claiming ? 'Claiming...' : `Claim ${claimTotal} USDC`}
                  </button>
                )}
                {claimStatus && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--neon-blue)', marginTop: 3 }}>{claimStatus}</div>
                )}
              </div>
              <button
                onClick={() => { disconnect(); setShowMenu(false); }}
                style={{
                  width: '100%', padding: '8px 10px', background: 'transparent', color: '#ff4466',
                  border: 'none', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                  fontSize: '0.75rem', textAlign: 'left', borderRadius: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,0,68,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        style={{
          padding: '8px 16px', fontSize: '0.85rem', borderRadius: '8px',
          background: 'var(--neon-green)', color: '#000',
          border: 'none', cursor: 'pointer',
          fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
        }}
      >
        Connect Wallet
      </button>
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 99999,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0f0f25', border: '1px solid #2a2a4a', borderRadius: 16,
              padding: '24px', width: 340, maxWidth: '90vw',
              boxShadow: '0 16px 64px rgba(0,0,0,0.8)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#fff' }}>Connect Wallet</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: 'transparent', border: 'none', color: '#888',
                  fontSize: '1.2rem', cursor: 'pointer', padding: '4px 8px',
                  width: 'auto', minWidth: 0,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {uniqueConnectors.map(connector => (
                <button
                  key={connector.uid}
                  onClick={() => {
                    connect({ connector });
                    setShowModal(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid #2a2a4a',
                    color: '#fff', cursor: 'pointer', fontFamily: 'Orbitron, monospace',
                    fontSize: '0.85rem', fontWeight: 'bold', transition: 'all 0.15s',
                    width: '100%',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(0,255,136,0.1)';
                    e.currentTarget.style.borderColor = 'var(--neon-green)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.borderColor = '#2a2a4a';
                  }}
                >
                  <img src={getWalletIcon(connector.id)} alt="" width={32} height={32} style={{ borderRadius: 6 }} />
                  {getWalletDisplayName(connector)}
                </button>
              ))}
            </div>
            <p style={{ margin: '16px 0 0', fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'center' }}>
              Choose a wallet to connect to Snake Arena
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// Issue 1: Bot Management with 5 slots, scrollable
function BotManagement() {
  const { isConnected, address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
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
  const miscTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [regHash, setRegHash] = useState<`0x${string}` | undefined>(undefined);
  const [regPending, setRegPending] = useState(false);
  const [regError, setRegError] = useState<Error | null>(null);
  const { isLoading: regConfirming, isSuccess: regConfirmed } = useWaitForTransactionReceipt({ hash: regHash });

  const guideUrl = window.location.origin + '/SNAKE_GUIDE.md';

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
      if (miscTimerRef.current) clearTimeout(miscTimerRef.current); miscTimerRef.current = setTimeout(() => setCopied(false), 2000);
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
      const signature = await signMessageAsync({ message });

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
        if (miscTimerRef.current) clearTimeout(miscTimerRef.current); miscTimerRef.current = setTimeout(() => { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); }, 1500);
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
    const t = setInterval(fetchBots, 20000);
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
      setRegPending(true);
      setRegError(null);
      try {
        const hash = await writeContractAsync({
          address: CONTRACTS.botRegistry as `0x${string}`,
          abi: BOT_REGISTRY_ABI,
          functionName: 'registerBot',
          args: [botId32, '0x0000000000000000000000000000000000000000' as `0x${string}`],
          value: parseEther('0.01'),
        });
        setRegHash(hash as `0x${string}`);
      } catch (e: any) {
        setRegError(e);
        // Extract revert reason for better error message
        const reason = e?.cause?.reason || e?.shortMessage || e?.message || '';
        if (reason.includes('Max') && reason.includes('bots per user')) {
          setRegStatus('⚠️ This wallet has reached the max bots limit on-chain. Use a different wallet.');
        } else if (reason.includes('already registered')) {
          setRegStatus('⚠️ This bot is already registered on-chain.');
        } else if (reason.includes('user rejected') || reason.includes('denied')) {
          setRegStatus('Transaction cancelled.');
        } else {
          setRegStatus('⚠️ Registration failed: ' + (e?.shortMessage || e?.message || 'Unknown error'));
        }
      }
      setRegPending(false);
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

      // Verify caller owns the NFT
      setSellStatus('Verifying NFT ownership...');
      const nftOwner = await publicClient.readContract({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'ownerOf',
        args: [tokenId],
      }) as string;
      if (nftOwner.toLowerCase() !== address.toLowerCase()) {
        setSellStatus(`You don't own this NFT (owner: ${nftOwner.slice(0,6)}...${nftOwner.slice(-4)})`);
        setSellBusy(false);
        return;
      }

      // Step 1: Check if already approved, skip if so
      const currentApproval = await publicClient.readContract({
        address: CONTRACTS.snakeBotNFT as `0x${string}`,
        abi: SNAKE_BOT_NFT_ABI,
        functionName: 'getApproved',
        args: [tokenId],
      }) as string;
      if (currentApproval.toLowerCase() !== (CONTRACTS.botMarketplace as string).toLowerCase()) {
        setSellStatus('1/2 Approving marketplace...');
        const approveTx = await writeContractAsync({
          address: CONTRACTS.snakeBotNFT as `0x${string}`,
          abi: SNAKE_BOT_NFT_ABI,
          functionName: 'approve',
          args: [CONTRACTS.botMarketplace as `0x${string}`, tokenId],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });
        // Wait for on-chain state to propagate and wallet nonce to update
        setSellStatus('Waiting for approval to confirm...');
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const newApproval = await publicClient.readContract({
            address: CONTRACTS.snakeBotNFT as `0x${string}`,
            abi: SNAKE_BOT_NFT_ABI,
            functionName: 'getApproved',
            args: [tokenId],
          }) as string;
          if (newApproval.toLowerCase() === (CONTRACTS.botMarketplace as string).toLowerCase()) break;
        }
      }

      // Step 2: List on marketplace
      setSellStatus('Listing on marketplace...');
      const priceWei = parseEther(sellPrice);
      const listTx = await writeContractAsync({
        address: CONTRACTS.botMarketplace as `0x${string}`,
        abi: BOT_MARKETPLACE_ABI,
        functionName: 'list',
        args: [tokenId, priceWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: listTx as `0x${string}` });

      setSellStatus('Listed! Your bot is now on the marketplace.');
      if (miscTimerRef.current) clearTimeout(miscTimerRef.current); miscTimerRef.current = setTimeout(() => { setSellBot(null); setSellPrice(''); setSellStatus(''); }, 2000);
    } catch (e: any) {
      let reason = '';
      let cur = e;
      while (cur) {
        if (cur.reason) { reason = cur.reason; break; }
        if (cur.data?.args?.[0]) { reason = String(cur.data.args[0]); break; }
        cur = cur.cause;
      }
      const msg = reason || e?.shortMessage || e?.message || 'Transaction failed';
      if (msg.includes('user rejected') || msg.includes('denied')) {
        setSellStatus('Cancelled');
      } else if (msg.includes('Not NFT owner')) {
        setSellStatus('You do not own this NFT');
      } else if (msg.includes('Not approved')) {
        setSellStatus('NFT approval failed — please try again');
      } else {
        setSellStatus(msg);
      }
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
        {bots.filter(b => b.registered).map((bot, i) => (
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
        {bots.filter(b => !b.registered).length > 0 && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '4px' }}>
            {bots.filter(b => !b.registered).length} bot(s) pending on-chain registration...
          </div>
        )}
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
                style={{ width: 'auto', minWidth: 0, margin: 0, background: '#333', color: '#aaa', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
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
                    style={{ width: 'auto', minWidth: 0, margin: 0, padding: '6px 16px', fontSize: '0.8rem', background: 'var(--neon-green)', color: '#000', fontWeight: 'bold' }}
                  >
                    {editBusy ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditBot(null); setEditCode(''); setEditToken(''); setEditStatus(''); }}
                    disabled={editBusy}
                    style={{ width: 'auto', minWidth: 0, margin: 0, padding: '6px 16px', fontSize: '0.8rem', background: '#333', color: '#aaa' }}
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
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget && !sellBusy) { setSellBot(null); setSellPrice(''); setSellStatus(''); } }}
        >
          <div style={{
            background: '#0d0d20', border: '1px solid var(--neon-pink)', borderRadius: '10px',
            padding: '16px', width: '90%', maxWidth: '360px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--neon-pink)', fontWeight: 'bold' }}>
                Sell: {sellBot.name || sellBot.botName || sellBot.botId}
              </div>
              <button onClick={() => { if (!sellBusy) { setSellBot(null); setSellPrice(''); setSellStatus(''); } }}
                style={{ width: 'auto', minWidth: 0, margin: 0, background: '#333', color: '#aaa', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>
                X
              </button>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                placeholder="Price"
                value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                type="number" min="0.001" step="0.001"
                style={{ flex: 1, fontSize: '0.85rem', width: 'auto' }}
              />
              <span style={{ color: '#aaa', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>ETH</span>
              <button onClick={handleSell} disabled={sellBusy}
                style={{ width: 'auto', minWidth: 0, margin: 0, padding: '6px 14px', fontSize: '0.8rem', background: 'var(--neon-pink)', color: '#fff', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
                {sellBusy ? '...' : 'List'}
              </button>
            </div>
            {sellStatus && <div className="muted" style={{ marginTop: '8px', fontSize: '0.8rem' }}>{sellStatus}</div>}
          </div>
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

// Prediction — on-chain USDC betting via SnakeArenaPariMutuel contract
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
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return alert('请输入 USDC 预测金额');
    if (!isConnected || !address) return alert('请先连接钱包');

    const botIdBytes32 = nameToBytes32(botName);
    const usdcAmount = parseUnits(amount, 6); // USDC has 6 decimals

    setBusy(true);
    try {
      // Step 0: Check USDC balance
      setStatus('检查 USDC 余额...');
      const usdcBalance = await publicClient.readContract({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      }) as bigint;

      if (usdcBalance < usdcAmount) {
        const balStr = (Number(usdcBalance) / 1e6).toFixed(2);
        setStatus(`❌ USDC 余额不足：当前 ${balStr} USDC，需要 ${amount} USDC。请先在 Base Sepolia 获取测试 USDC`);
        setBusy(false);
        return;
      }

      // Step 1: Check match exists on-chain
      setStatus('验证链上比赛...');
      try {
        const matchData = await publicClient.readContract({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'matches',
          args: [BigInt(mid)],
        }) as any;
        if (!matchData || matchData[0] === 0n) {
          setStatus('❌ 该比赛尚未在链上创建 — 请等待新比赛开始后再下注');
          setBusy(false);
          return;
        }
        if (matchData[4]) { // settled
          setStatus('❌ 该比赛已结算');
          setBusy(false);
          return;
        }
      } catch {
        setStatus('❌ 无法查询链上比赛状态，请稍后重试');
        setBusy(false);
        return;
      }

      // Step 2: Check USDC allowance, approve max if needed
      setStatus('检查 USDC 授权...');
      const currentAllowance = await publicClient.readContract({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, CONTRACTS.pariMutuel as `0x${string}`],
      }) as bigint;

      if (currentAllowance < usdcAmount) {
        setStatus('授权 USDC...');
        const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const approveTx = await writeContractAsync({
          address: CONTRACTS.usdc as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [CONTRACTS.pariMutuel as `0x${string}`, maxApproval],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx as `0x${string}` });
      }

      // Step 3: Place bet on-chain (USDC, no ETH value)
      setStatus('签名预测交易...');
      const betTx = await writeContractAsync({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'placeBet',
        args: [BigInt(mid), botIdBytes32, usdcAmount],
      });

      setStatus('链上确认中...');
      await publicClient.waitForTransactionReceipt({ hash: betTx as `0x${string}` });

      setStatus(`✅ 预测成功！${amount} USDC 预测 ${botName} 赢`);
      setAmount('');
    } catch (e: any) {
      // Extract revert reason from error chain
      let reason = '';
      let cur = e;
      while (cur) {
        if (cur.reason) { reason = cur.reason; break; }
        if (cur.data?.args?.[0]) { reason = String(cur.data.args[0]); break; }
        cur = cur.cause;
      }
      const msg = reason || e?.shortMessage || e?.message || '交易失败';
      if (msg.includes('user rejected') || msg.includes('denied')) {
        setStatus('已取消');
      } else if (msg.includes('Match does not exist')) {
        setStatus('❌ 该比赛尚未在链上创建 — 请等待比赛开始后再下注');
      } else if (msg.includes('Betting closed')) {
        setStatus('❌ 下注窗口已关闭（比赛开始后5分钟内可下注）');
      } else if (msg.includes('settled') || msg.includes('already settled')) {
        setStatus('❌ 该比赛已结算');
      } else if (msg.includes('USDC transfer failed')) {
        setStatus('❌ USDC 转账失败 — 请确认余额充足且已授权');
      } else if (msg.includes('Bet amount')) {
        setStatus('❌ 下注金额必须大于 0');
      } else {
        setStatus('❌ ' + msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>当前比赛</span><span>{displayMatchId ? `Epoch ${epoch} #${displayMatchId}` : '--'}</span></div>
      <input placeholder="比赛编号 (如 P5, A3)" value={targetMatch} onChange={e => setTargetMatch(e.target.value)} />
      <input placeholder="机器人名称 (预测谁赢?)" value={botName} onChange={e => setBotName(e.target.value)} style={{ marginTop: '6px' }} />
      <input placeholder="USDC 金额" value={amount} onChange={e => setAmount(e.target.value)} type="number" min="1" step="1" style={{ marginTop: '6px' }} />
      <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
        {['1', '5', '10'].map(v => (
          <button key={v} onClick={() => setAmount(v)} type="button"
            style={{ flex: 1, padding: '4px', fontSize: '0.75rem', background: amount === v ? 'var(--neon-green)' : '#1a1a2e', color: amount === v ? '#000' : '#aaa' }}>
            {v} USDC
          </button>
        ))}
      </div>
      <button onClick={handlePredict} disabled={busy} style={{ marginTop: '6px' }}>
        {busy ? '⏳ ' + status : '💰 USDC 预测'}
      </button>
      {!busy && status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

function CompetitiveEnter({ displayMatchId }: { displayMatchId: string | null }) {
  const { isConnected, address } = useAccount();
  const [botName, setBotName] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const { sendTransactionAsync } = useSendTransaction();

  const handleEnter = async () => {
    if (!isConnected || !address) return alert('Connect Wallet');
    if (!botName) return alert('Enter Bot Name');
    if (!targetMatch) return alert('Enter target match (e.g. A3)');

    setBusy(true);
    try {
      setStatus('Looking up bot...');
      const res = await fetch('/api/bot/lookup?name=' + encodeURIComponent(botName));
      if (!res.ok) {
        const err = await res.json();
        setStatus('⚠️ ' + (err.error === 'bot_not_found' ? 'Bot "' + botName + '" not found' : err.error));
        setBusy(false);
        return;
      }
      const data = await res.json();
      const resolvedBotId = data.botId;

      // Pay entry fee (0.001 ETH) via ETH transfer to backend wallet
      setStatus('Sign transaction (0.001 ETH)...');
      const txHash = await sendTransactionAsync({
        to: '0xBa379b9AaF5eac6eCF9B532cb6563390De6edfEe' as `0x${string}`,
        value: parseEther('0.001'),
      });

      setStatus('Confirming on-chain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      // Notify server of paid entry
      setStatus('Registering entry...');
      const enterRes = await fetch('/api/competitive/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: resolvedBotId, displayMatchId: targetMatch, txHash })
      });
      const enterData = await enterRes.json();
      setStatus(enterData.ok ? '✅ Entry confirmed for match ' + targetMatch : '⚠️ ' + (enterData.error || enterData.message || 'Failed'));
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Failed';
      if (msg.includes('user rejected') || msg.includes('denied')) {
        setStatus('Transaction cancelled.');
      } else {
        setStatus('⚠️ ' + msg);
      }
    }
    setBusy(false);
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
      <button onClick={handleEnter} disabled={busy} style={{ marginTop: '6px' }}>
        {busy ? status || '...' : '🎯 Enter Arena'}
      </button>
      {!busy && status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
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
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const logicalSize = canvas.width / dpr;
        const cellSize = logicalSize / 30;

        renderFrame(ctx, state, cellSize, logicalSize, logicalSize, foodImgRef.current, {
          gridColor: isCompetitive ? '#1a1020' : '#1a1a2e',
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
          <canvas ref={canvasRef} width={600 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)} height={600 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)} style={{ width: 'min(600px, 90vw, 70vh)', height: 'min(600px, 90vw, 70vh)', border: `4px solid ${borderColor}`, background: '#000' }}></canvas>
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
  bet_activity: '预测参与',
  bet_win: '预测赢利',
  referral_l1: '邀请奖励 L1',
  referral_l2: '邀请奖励 L2',
};

// Full-page Points view — now shows Airdrop Points + Prediction Balance
function PointsPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
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
      const signature = await signMessageAsync({ message });

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

            {/* Prediction Balance */}
            {myBalance && (
              <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(0,136,255,0.1)', borderRadius: '6px', marginBottom: '12px' }}>
                <span className="muted">Prediction Balance: </span>
                <span style={{ color: 'var(--neon-blue)', fontWeight: 'bold' }}>{myBalance.points || 0} pts</span>
              </div>
            )}

            {/* Points breakdown */}
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '8px', textAlign: 'center' }}>
              Airdrop points are accumulate-only (never decrease). Prediction balance is separate.
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
            <span>Place a prediction</span><span style={{ color: 'var(--neon-green)' }}>+amount USDC</span>
            <span>Win a prediction</span><span style={{ color: 'var(--neon-green)' }}>profit x 0.5</span>
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

// Portfolio button — shown in header next to wallet button
function PortfolioButton({ activePage, onSwitch }: { activePage: string; onSwitch: (p: any) => void }) {
  const { isConnected } = useAccount();
  if (!isConnected) return null;
  const isActive = activePage === 'portfolio';
  return (
    <button
      onClick={() => onSwitch('portfolio')}
      style={{
        padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px',
        background: isActive ? 'var(--neon-green)' : 'rgba(0,255,136,0.1)',
        color: isActive ? '#000' : 'var(--neon-green)',
        border: '1px solid var(--neon-green)', cursor: 'pointer',
        fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
      }}
    >
      Portfolio
    </button>
  );
}

// Full-page Portfolio view — positions, history, claim
function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'positions' | 'history'>('positions');
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState('');

  const loadData = async () => {
    if (!address) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/portfolio?address=${address}`);
      if (res.ok) setData(await res.json());
    } catch (_e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    loadData();
    const t = setInterval(loadData, 15000);
    return () => clearInterval(t);
  }, [address]);

  const handleClaimAll = async () => {
    if (!data?.claimable?.length || claiming) return;
    setClaiming(true);
    setClaimStatus('Claiming...');
    let claimed = 0;
    for (const item of data.claimable) {
      try {
        await writeContractAsync({
          address: CONTRACTS.pariMutuel as `0x${string}`,
          abi: PARI_MUTUEL_ABI,
          functionName: 'claimWinnings',
          args: [BigInt(item.matchId)],
        });
        claimed++;
        setClaimStatus(`Claimed ${claimed}/${data.claimable.length}...`);
      } catch (e: any) {
        const msg = e?.shortMessage || e?.message || '';
        if (msg.includes('rejected') || msg.includes('denied')) {
          setClaimStatus('Cancelled');
          setClaiming(false);
          return;
        }
        setClaimStatus(`Match #${item.matchId} failed, continuing...`);
      }
    }
    setClaiming(false);
    setClaimStatus(claimed > 0 ? `Claimed ${claimed} match(es)!` : 'No claims succeeded');
    loadData();
  };

  if (!isConnected) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--neon-green)', marginBottom: '16px' }}>Portfolio</h2>
        <div className="panel-card muted" style={{ maxWidth: 400, margin: '0 auto', padding: 24 }}>
          Connect your wallet to view your portfolio
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '20px' }}>Portfolio</h2>

      {/* Claimable Winnings Banner — always visible */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        {(() => {
          const hasClaimable = data && parseFloat(data.claimableTotal) > 0;
          return (
            <div className="panel-card" style={{
              background: hasClaimable ? 'rgba(0,255,136,0.08)' : 'rgba(255,255,255,0.03)',
              border: hasClaimable ? '1px solid var(--neon-green)' : '1px solid #2a2a4a',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderRadius: '10px',
            }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>Claimable Winnings</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: hasClaimable ? 'var(--neon-green)' : '#555' }}>
                  {data ? data.claimableTotal : '...'} USDC
                </div>
              </div>
              <button
                onClick={handleClaimAll}
                disabled={claiming || !hasClaimable}
                style={{
                  padding: '10px 24px', borderRadius: '8px',
                  background: !hasClaimable ? '#222' : claiming ? '#333' : 'var(--neon-green)',
                  color: !hasClaimable ? '#555' : claiming ? '#888' : '#000',
                  border: 'none',
                  cursor: !hasClaimable || claiming ? 'not-allowed' : 'pointer',
                  fontFamily: 'Orbitron, monospace', fontSize: '0.85rem', fontWeight: 'bold',
                }}
              >
                {claiming ? 'Claiming...' : 'Claim All'}
              </button>
            </div>
          );
        })()}
        {claimStatus && (
          <div style={{ fontSize: '0.75rem', color: 'var(--neon-blue)', marginTop: 6, textAlign: 'center' }}>{claimStatus}</div>
        )}
      </div>

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={() => setTab('positions')}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #2a2a4a',
            background: tab === 'positions' ? 'rgba(0,255,136,0.15)' : 'transparent',
            color: tab === 'positions' ? 'var(--neon-green)' : '#888',
            cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontWeight: 'bold', fontSize: '0.82rem',
          }}
        >
          Active Positions
        </button>
        <button
          onClick={() => setTab('history')}
          style={{
            flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #2a2a4a',
            background: tab === 'history' ? 'rgba(0,255,136,0.15)' : 'transparent',
            color: tab === 'history' ? 'var(--neon-green)' : '#888',
            cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontWeight: 'bold', fontSize: '0.82rem',
          }}
        >
          History
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="panel-card muted" style={{ textAlign: 'center', padding: 24 }}>Loading...</div>
      ) : tab === 'positions' ? (
        <div className="panel-section">
          <h3>Active Positions</h3>
          {(!data?.activePositions || data.activePositions.length === 0) ? (
            <div className="panel-card muted">No active positions</div>
          ) : (
            <ul className="fighter-list">
              {data.activePositions.map((p: any, i: number) => (
                <li key={i} className="fighter-item alive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="fighter-name">
                    Match {p.displayMatchId} &middot; {p.botId}
                  </span>
                  <span style={{ display: 'flex', gap: '12px', fontSize: '0.8rem' }}>
                    <span style={{ color: 'var(--neon-blue)' }}>{p.amount} USDC</span>
                    <span className="muted">Pool: {p.poolTotal}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="panel-section">
          <h3>Bet History</h3>
          {(!data?.betHistory || data.betHistory.length === 0) ? (
            <div className="panel-card muted">No bet history</div>
          ) : (
            <ul className="fighter-list">
              {data.betHistory.map((h: any, i: number) => (
                <li key={i} className="fighter-item alive" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="fighter-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                      background: h.type === 'bet_win' ? 'var(--neon-green)' : '#ff4466',
                    }} />
                    {h.type === 'bet_win' ? 'Win' : h.type === 'bet_place' ? 'Bet' : h.type === 'bet_activity' ? 'Bet' : h.type}
                    {h.displayMatchId ? ` #${h.displayMatchId}` : ''}
                  </span>
                  <span style={{
                    color: h.type === 'bet_win' ? 'var(--neon-green)' : '#ff4466',
                    fontWeight: 'bold', fontSize: '0.85rem',
                  }}>
                    {h.type === 'bet_win' ? '+' : '-'}{h.amount} {typeof h.amount === 'number' && h.amount > 100 ? 'pts' : 'USDC'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        try {
          await fetch('/api/bot/claim-nft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botId: item.botId, address, txHash }),
          });
        } catch (claimErr) {
          console.warn('[Marketplace] claim-nft failed:', claimErr);
        }
      }
      setActionStatus('Done!');
      await loadListings();
    } catch (e: any) {
      setActionStatus(e?.shortMessage || e?.message || 'Transaction failed');
    }
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => { setActionId(null); setActionStatus(''); }, 3000);
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
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => { setActionId(null); setActionStatus(''); }, 3000);
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

// --- Replay Page ---
function ReplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const foodImgRef = useRef<HTMLImageElement | null>(null);
  const animRef = useRef<number>(0);

  const [inputId, setInputId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [replay, setReplay] = useState<any>(null);

  // Playback state
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frameIdx, setFrameIdx] = useState(0);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const frameIdxRef = useRef(0);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { frameIdxRef.current = frameIdx; }, [frameIdx]);

  // Load food image once
  useEffect(() => {
    const img = new Image();
    img.src = foodSvgUrl;
    img.onload = () => { foodImgRef.current = img; };
  }, []);

  const loadReplay = async () => {
    const id = inputId.trim().toUpperCase();
    if (!id) return;
    setLoading(true);
    setError('');
    setReplay(null);
    setPlaying(false);
    setFrameIdx(0);
    cancelAnimationFrame(animRef.current);
    try {
      // Try display ID first (P109, A5), then raw numeric
      const isDisplayId = /^[PA]\d+$/i.test(id);
      const url = isDisplayId
        ? `/api/replay/by-display-id?id=${encodeURIComponent(id)}`
        : `/api/replay/${encodeURIComponent(id)}`;
      const res = await fetch(url);
      if (res.status === 404) { setError('Replay not found'); setLoading(false); return; }
      if (res.status === 429) { setError('Too many requests, please wait'); setLoading(false); return; }
      if (!res.ok) { setError('Failed to load replay'); setLoading(false); return; }
      const data = await res.json();
      if (!data.frames || data.frames.length === 0) { setError('Replay has no frames'); setLoading(false); return; }
      setReplay(data);
      setFrameIdx(0);
    } catch (e: any) {
      setError(e?.message || 'Network error');
    }
    setLoading(false);
  };

  // Animation loop
  useEffect(() => {
    if (!replay || !playing) return;
    let lastTime = 0;
    const baseInterval = 125; // ms per frame at 1x
    const tick = (ts: number) => {
      if (!playingRef.current) return;
      if (lastTime === 0) lastTime = ts;
      const elapsed = ts - lastTime;
      const interval = baseInterval / speedRef.current;
      if (elapsed >= interval) {
        lastTime = ts;
        const next = frameIdxRef.current + 1;
        if (next >= replay.frames.length) {
          setPlaying(false);
          return;
        }
        setFrameIdx(next);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [replay, playing]);

  // Render current frame to canvas
  useEffect(() => {
    if (!replay || !replay.frames[frameIdx]) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const logicalSize = canvas.width / dpr;
    const cellSize = logicalSize / 30;
    const frame = replay.frames[frameIdx];
    const isComp = replay.arenaType === 'competitive';
    renderFrame(ctx, frame, cellSize, logicalSize, logicalSize, foodImgRef.current, {
      gridColor: isComp ? '#1a1020' : '#1a1a2e',
    });
  }, [replay, frameIdx]);

  const totalFrames = replay?.frames?.length || 0;
  const currentFrame = replay?.frames?.[frameIdx];
  const firstFrame = replay?.frames?.[0];

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-blue)', textAlign: 'center', marginBottom: '20px' }}>Match Replay</h2>

      {/* Input */}
      <div className="panel-section" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
          <input
            type="text"
            value={inputId}
            onChange={e => setInputId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadReplay()}
            placeholder="Match ID (e.g. P109, A5)"
            style={{
              padding: '8px 14px', fontSize: '1rem', borderRadius: '8px',
              background: '#0a0a1a', color: '#fff', border: '1px solid #2a2a4a',
              fontFamily: 'Orbitron, monospace', width: '200px',
            }}
          />
          <button
            onClick={loadReplay}
            disabled={loading || !inputId.trim()}
            style={{
              padding: '8px 20px', fontSize: '0.9rem', fontWeight: 'bold', borderRadius: '8px',
              background: loading ? '#333' : 'var(--neon-blue)', color: loading ? '#666' : '#000',
              border: 'none', cursor: loading ? 'default' : 'pointer',
              fontFamily: 'Orbitron, monospace',
            }}
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
        {error && <div style={{ color: '#ff4466', textAlign: 'center', marginTop: '8px', fontSize: '0.85rem' }}>{error}</div>}
      </div>

      {/* Match info */}
      {replay && (
        <div className="panel-section" style={{ marginBottom: '16px' }}>
          <div className="panel-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: '0.85rem' }}>
            <span className="muted">Match</span><span>{replay.arenaType === 'competitive' ? 'A' : 'P'}{replay.matchId}</span>
            <span className="muted">Arena</span><span>{replay.arenaType || replay.arenaId}</span>
            <span className="muted">Time</span><span>{replay.timestamp ? new Date(replay.timestamp).toLocaleString() : '--'}</span>
            <span className="muted">Winner</span><span style={{ color: 'var(--neon-green)' }}>{replay.winner || 'No Winner'}</span>
            <span className="muted">Score</span><span>{replay.winnerScore ?? '--'}</span>
            <span className="muted">Frames</span><span>{totalFrames}</span>
          </div>
          {/* Players from first frame */}
          {firstFrame?.players && (
            <div style={{ marginTop: '8px' }}>
              <div className="muted" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Players:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {firstFrame.players.map((p: any, i: number) => (
                  <span key={i} style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem',
                    background: 'rgba(255,255,255,0.05)', color: p.color || '#fff',
                    border: `1px solid ${p.color || '#333'}`,
                  }}>{p.name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Canvas + Controls */}
      {replay && (
        <div style={{ textAlign: 'center' }}>
          {/* Timer display */}
          <div style={{ fontSize: '1.2rem', fontFamily: 'Orbitron, monospace', color: '#ff8800', marginBottom: '6px' }}>
            {currentFrame ? `${Math.floor(currentFrame.matchTimeLeft / 60)}:${(currentFrame.matchTimeLeft % 60).toString().padStart(2, '0')}` : '--:--'}
            <span className="muted" style={{ fontSize: '0.75rem', marginLeft: '12px' }}>
              Frame {frameIdx + 1}/{totalFrames}
            </span>
          </div>

          <div className="canvas-wrap" style={{ display: 'inline-block' }}>
            <canvas
              ref={canvasRef}
              width={600 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)}
              height={600 * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)}
              style={{
                width: 'min(600px, 90vw, 70vh)', height: 'min(600px, 90vw, 70vh)',
                border: `4px solid ${replay.arenaType === 'competitive' ? 'var(--neon-pink)' : 'var(--neon-blue)'}`,
                background: '#000',
              }}
            />
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setPlaying(!playing)}
              style={{
                padding: '6px 16px', fontSize: '0.85rem', borderRadius: '6px',
                background: 'rgba(0,136,255,0.2)', color: 'var(--neon-blue)',
                border: '1px solid var(--neon-blue)', cursor: 'pointer',
                fontFamily: 'Orbitron, monospace', fontWeight: 'bold', minWidth: '70px',
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            {[1, 2, 4].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                style={{
                  padding: '4px 10px', fontSize: '0.8rem', borderRadius: '6px',
                  background: speed === s ? 'var(--neon-blue)' : 'rgba(0,136,255,0.1)',
                  color: speed === s ? '#000' : 'var(--neon-blue)',
                  border: '1px solid var(--neon-blue)', cursor: 'pointer',
                  fontFamily: 'Orbitron, monospace', fontWeight: 'bold',
                }}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: '10px', padding: '0 10px' }}>
            <input
              type="range"
              min={0}
              max={Math.max(totalFrames - 1, 0)}
              value={frameIdx}
              onChange={e => { setFrameIdx(Number(e.target.value)); setPlaying(false); }}
              style={{ width: '100%', accentColor: 'var(--neon-blue)' }}
            />
          </div>
        </div>
      )}
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
  const [activePage, setActivePage] = useState<'performance' | 'competitive' | 'leaderboard' | 'points' | 'marketplace' | 'portfolio' | 'replay'>('performance');

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
    const t = setInterval(load, 30000);
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
          <div className="app">
            <header className="top-tabs">
              <button className={`tab ${activePage === 'performance' ? 'active' : ''}`} onClick={() => switchPage('performance')}>🦀 表演场</button>
              <button className={`tab tab-competitive ${activePage === 'competitive' ? 'active' : ''}`} onClick={() => switchPage('competitive')}>⚔️ 竞技场</button>
              <button className={`tab ${activePage === 'leaderboard' ? 'active' : ''}`} onClick={() => switchPage('leaderboard')}>🏆 排行榜</button>
              <button className={`tab ${activePage === 'points' ? 'active' : ''}`} onClick={() => switchPage('points')}>⭐ 积分</button>
              <button className={`tab ${activePage === 'marketplace' ? 'active' : ''}`} onClick={() => switchPage('marketplace')}>🏪 市场</button>
              <button className={`tab ${activePage === 'replay' ? 'active' : ''}`} onClick={() => switchPage('replay')}>🎬 回放</button>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PortfolioButton activePage={activePage} onSwitch={switchPage} />
                <WalletButton />
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
            ) : activePage === 'replay' ? (
              <ReplayPage />
            ) : activePage === 'portfolio' ? (
              <PortfolioPage />
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
      </QueryClientProvider>
    </WagmiProvider>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#ff4466', fontFamily: 'Orbitron, monospace' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#888' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 20, padding: '8px 24px', background: 'var(--neon-green)', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithBoundary;
