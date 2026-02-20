import React, { useState, useEffect, useRef } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { parseEther, parseUnits, stringToHex, padHex } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import './index.css';
import { CONTRACTS, BOT_REGISTRY_ABI, PARI_MUTUEL_ABI, ERC20_ABI } from './contracts';

// --- CONFIG ---
const config = getDefaultConfig({
  appName: 'Snake Arena',
  projectId: '7e5c5e3e3f5e5c5e3f5e5c5e3f5e5c5e',
  chains: [baseSepolia],
  ssr: false,
});

const queryClient = new QueryClient();

const MAX_BOT_SLOTS = 5;

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
  const [bots, setBots] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [regStatus, setRegStatus] = useState('');
  const [copied, setCopied] = useState(false);

  const { writeContract, data: regHash, isPending: regPending, error: regError } = useWriteContract();
  const { isLoading: regConfirming, isSuccess: regConfirmed } = useWaitForTransactionReceipt({ hash: regHash });

  const guideText = 'read http://107.174.228.72:3000/SNAKE_GUIDE.md';

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
    doCopy(guideText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Fetch user's bots from server
  useEffect(() => {
    if (!address) { setBots([]); return; }
    const fetchBots = async () => {
      try {
        const res = await fetch('/api/bot/my-bots?owner=' + address);
        if (res.ok) {
          const data = await res.json();
          setBots(data.bots || []);
        }
      } catch {}
    };
    fetchBots();
    const t = setInterval(fetchBots, 10000);
    return () => clearInterval(t);
  }, [address]);

  // Issue 2: Register — first create on server, then call on-chain registerBot
  const handleRegister = async () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!newName) return alert('Enter Bot Name');

    try {
      setRegStatus('Creating bot on server...');
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

  useEffect(() => {
    if (regConfirming) setRegStatus('Confirming on-chain...');
    if (regConfirmed && regHash) {
      setRegStatus('✅ Registered on-chain! NFT minted.');
      setNewName('');
    }
    if (regError) setRegStatus('⚠️ ' + regError.message);
  }, [regConfirming, regConfirmed, regHash, regError]);

  const displaySlots = Math.max(3, Math.min(MAX_BOT_SLOTS, bots.length + 1));

  return (
    <div className="panel-card" style={{ maxHeight: '320px', overflowY: 'auto' }}>
      <div style={{ marginBottom: '6px', color: '#fff', fontSize: '0.85rem' }}>
        Click to copy instructions for your AI bot:
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
          fontFamily: 'monospace', fontSize: '0.9rem', color: 'var(--neon-green)',
          position: 'relative', userSelect: 'all',
          wordBreak: 'break-all' as const, lineHeight: '1.4',
        }}
      >
        📋 {guideText}
        {copied && (
          <span style={{
            position: 'absolute', right: 8, top: '-28px',
            background: 'var(--neon-green)', color: '#000', padding: '3px 10px', borderRadius: '4px',
            fontSize: '0.75rem', fontWeight: 'bold', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,255,136,0.4)', zIndex: 10,
          }}>✅ Copied!</span>
        )}
      </div>

      {/* Bot Slots */}
      <div style={{ marginTop: '10px' }}>
        {Array.from({ length: displaySlots }).map((_, i) => {
          const bot = bots[i];
          if (bot) {
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 8px', marginBottom: '4px', borderRadius: '6px',
                background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.3)',
              }}>
                <span style={{ color: 'var(--neon-green)', fontWeight: 'bold', fontSize: '0.85rem' }}>
                  🤖 {bot.name}
                </span>
                <span className="muted" style={{ fontSize: '0.75rem' }}>
                  {bot.unlimited ? '∞' : (bot.credits || 0) + ' credits'}
                </span>
              </div>
            );
          }
          return (
            <div key={i} style={{
              padding: '6px 8px', marginBottom: '4px', borderRadius: '6px',
              background: 'rgba(255,255,255,0.03)', border: '1px dashed #2a2a3a',
              color: '#555', fontSize: '0.8rem', textAlign: 'center',
            }}>
              Empty Slot {i + 1}/{MAX_BOT_SLOTS}
            </div>
          );
        })}
      </div>

      {bots.length < MAX_BOT_SLOTS && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
          <input placeholder="Bot Name" value={newName} onChange={e => setNewName(e.target.value)} style={{ flex: 1 }} />
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

// Prediction with USDC — sequential approve → placeBet using writeContractAsync
function Prediction({ matchId, displayMatchId, arenaType }: { matchId: number | null; displayMatchId: string | null; arenaType: 'performance' | 'competitive' }) {
  const { isConnected, address } = useAccount();
  const [botName, setBotName] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [amount, setAmount] = useState('1');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    if (matchId !== null) setTargetMatch(String(matchId));
  }, [matchId]);

  const handlePredict = async () => {
    const mid = parseInt(targetMatch);
    if (isNaN(mid)) return alert('Enter a valid Match #');
    if (!botName) return alert('Enter Bot Name');
    if (!isConnected) return alert('Connect Wallet');
    const usdcAmount = parseFloat(amount);
    if (isNaN(usdcAmount) || usdcAmount <= 0) return alert('Enter valid USDC amount');

    const usdcUnits = parseUnits(amount, 6);
    const botId32 = nameToBytes32(botName);

    setBusy(true);
    try {
      // Step 1: Approve USDC
      setStatus('Step 1/2: Approve USDC spending...');
      const approveHash = await writeContractAsync({
        address: CONTRACTS.usdc as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.pariMutuel as `0x${string}`, usdcUnits],
      });

      setStatus('Waiting for approval confirmation...');
      await waitForTransactionReceipt(config, { hash: approveHash });

      // Step 2: Place bet
      setStatus('Step 2/2: Placing prediction on-chain...');
      const betHash = await writeContractAsync({
        address: CONTRACTS.pariMutuel as `0x${string}`,
        abi: PARI_MUTUEL_ABI,
        functionName: 'placeBet',
        args: [BigInt(mid), botId32, usdcUnits],
      });

      setStatus('Waiting for bet confirmation...');
      await waitForTransactionReceipt(config, { hash: betHash });

      // Step 3: Notify server
      setStatus('Notifying server...');
      const res = await fetch('/api/prediction/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: mid, botId: botName, amount: usdcUnits.toString(), txHash: betHash, bettor: address, arenaType })
      });
      const data = await res.json();
      setStatus(data.ok ? '✅ Prediction Placed!' : '⚠️ Server: ' + (data.error || 'Error'));
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || 'Unknown error';
      setStatus('Error: ' + msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Current Match</span><span>{displayMatchId || (matchId !== null ? `#${matchId}` : '--')}</span></div>
      <input placeholder="Match # (global ID)" value={targetMatch} onChange={e => setTargetMatch(e.target.value)} type="number" />
      <input placeholder="Bot Name" value={botName} onChange={e => setBotName(e.target.value)} style={{ marginTop: '6px' }} />
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        {[1, 5, 10].map(val => (
          <button key={val} onClick={() => setAmount(val.toString())}
            style={{ flex: 1, background: amount === val.toString() ? 'var(--neon-green)' : undefined, color: amount === val.toString() ? '#000' : undefined }}>
            {val} USDC
          </button>
        ))}
      </div>
      <input placeholder="Custom USDC Amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ marginTop: '6px' }} />
      <button onClick={handlePredict} disabled={busy} style={{ marginTop: '6px' }}>
        {busy ? '⏳ Processing...' : '🔮 Predict (USDC)'}
      </button>
      <div className="muted" style={{ marginTop: '6px' }}>{status}</div>
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

      const botId32 = nameToBytes32(data.botId);
      writeContract({
        address: CONTRACTS.botRegistry as `0x${string}`,
        abi: BOT_REGISTRY_ABI,
        functionName: 'registerBot',
        args: [botId32, '0x0000000000000000000000000000000000000000' as `0x${string}`],
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
      } catch {}
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

    const connect = () => {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => setStatus('Connected!');
        ws.onclose = () => setStatus('Disconnected...');
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'update') render(msg.state);
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

        ctx.fillStyle = '#ff0055';
        ctx.shadowColor = '#ff0055'; ctx.shadowBlur = 10;
        state.food.forEach((f: any) => {
            ctx.beginPath(); ctx.arc(f.x*cellSize+cellSize/2, f.y*cellSize+cellSize/2, cellSize/3, 0, Math.PI*2); ctx.fill();
        });
        ctx.shadowBlur = 0;

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

    return () => { if (ws) ws.close(); };
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

// Full-page Points view
function PointsPage() {
  const { address } = useAccount();
  const [myPoints, setMyPoints] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [myRes, lbRes] = await Promise.all([
          address ? fetch('/api/points/my?address=' + address) : Promise.resolve(null),
          fetch('/api/points/leaderboard'),
        ]);
        if (myRes && myRes.ok) setMyPoints(await myRes.json());
        if (lbRes.ok) setLeaderboard(await lbRes.json());
      } catch {}
    };
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [address]);

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '20px' }}>⭐ Points</h2>

      {/* My Points Card */}
      <div className="panel-section" style={{ marginBottom: '24px' }}>
        <h3>My Points</h3>
        {!address ? (
          <div className="panel-card muted">Connect wallet to see your points</div>
        ) : !myPoints ? (
          <div className="panel-card muted">Loading...</div>
        ) : (
          <div className="panel-card">
            <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--neon-green)' }}>{myPoints.points || 0}</div>
                <div className="muted">Total Points</div>
              </div>
              {myPoints.rank && (
                <div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--neon-blue)' }}>#{myPoints.rank}</div>
                  <div className="muted">Rank</div>
                </div>
              )}
            </div>
            {myPoints.history && myPoints.history.length > 0 && (
              <>
                <h4 style={{ color: '#aaa', fontSize: '0.85rem', marginBottom: '6px' }}>Recent Activity</h4>
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  {myPoints.history.slice(0, 20).map((h: any, i: number) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', padding: '4px 8px',
                      borderBottom: '1px solid #1b1b2b', fontSize: '0.8rem',
                    }}>
                      <span className="muted">{h.type || 'match'}</span>
                      <span style={{ color: 'var(--neon-green)' }}>+{h.points || h.amount || '?'}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Points Leaderboard */}
      <div className="panel-section">
        <h3>Points Leaderboard</h3>
        <ul className="fighter-list">
          {leaderboard.map((p: any, i: number) => (
            <li key={i} className="fighter-item alive">
              <span className="fighter-name">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}{' '}
                {p.address ? (p.address.slice(0, 6) + '...' + p.address.slice(-4)) : p.name || 'unknown'}
              </span>
              <span className="fighter-length" style={{ color: 'var(--neon-green)' }}>{p.points || 0} pts</span>
            </li>
          ))}
          {leaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
        </ul>
      </div>
    </div>
  );
}

// Full-page Marketplace view
function MarketplacePage() {
  const { isConnected } = useAccount();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/marketplace/listings?offset=0&limit=50');
        if (res.ok) {
          const data = await res.json();
          setListings(data.listings || []);
        }
      } catch {}
      setLoading(false);
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: '24px', width: '100%', maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ color: 'var(--neon-pink)', textAlign: 'center', marginBottom: '20px' }}>🏪 Bot Marketplace</h2>

      <div className="panel-section">
        {loading ? (
          <div className="panel-card muted">Loading marketplace...</div>
        ) : listings.length === 0 ? (
          <div className="panel-card">
            <div className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🏪</div>
              <p>No bots are currently listed for sale.</p>
              <p style={{ fontSize: '0.8rem', marginTop: '8px' }}>
                Bot owners can list their bots via the smart contract:<br/>
                <code style={{ color: 'var(--neon-blue)' }}>BotRegistry.listForSale(botId, priceInWei)</code>
              </p>
            </div>
          </div>
        ) : (
          <div>
            {listings.map((bot, i) => (
              <div key={i} className="panel-card" style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{bot.botName || bot.botId}</div>
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      Owner: {bot.owner ? (bot.owner.slice(0, 6) + '...' + bot.owner.slice(-4)) : 'unknown'}
                      {bot.matchesPlayed ? ` | ${bot.matchesPlayed} matches` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: 'var(--neon-pink)', fontWeight: 'bold', fontSize: '1.1rem' }}>{bot.price} ETH</div>
                    {isConnected && (
                      <button style={{ fontSize: '0.75rem', padding: '4px 12px', marginTop: '4px' }}>Buy</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [matchId, setMatchId] = useState<number | null>(null);
  const [displayMatchId, setDisplayMatchId] = useState<string | null>(null);
  const [, setEpoch] = useState(1);
  const [players, setPlayers] = useState<any[]>([]);
  const [perfLeaderboard, setPerfLeaderboard] = useState<any[]>([]);
  const [compLeaderboard, setCompLeaderboard] = useState<any[]>([]);
  const [activePage, setActivePage] = useState<'performance' | 'competitive' | 'leaderboard' | 'points' | 'marketplace'>('performance');

  const playersRef = useRef<any[]>([]);
  const lastPlayersUpdate = useRef(0);
  const throttledSetPlayers = useRef((p: any[]) => {
    playersRef.current = p;
    const now = Date.now();
    if (now - lastPlayersUpdate.current > 500) {
      lastPlayersUpdate.current = now;
      setPlayers(p);
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
                    <Prediction matchId={matchId} displayMatchId={displayMatchId} arenaType={activePage as 'performance' | 'competitive'} />
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
                      {players.sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0)).map((p, i) => (
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
