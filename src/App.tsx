import React, { useState, useEffect, useRef } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import './index.css';

// --- CONFIG ---
const config = getDefaultConfig({
  appName: 'Snake Arena',
  projectId: 'YOUR_PROJECT_ID',
  chains: [baseSepolia],
  ssr: false, 
});

const queryClient = new QueryClient();

// --- CONTRACT ---
const CONTRACT_ADDRESS = "0xAf077e41644529AF966EBC9B49849c94cDf80EE2";

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
- 15秒赛前准备 → 3分钟比赛 → 30秒休息
- 30×30 地图 | 125ms/tick | 食物上限5个
`;

const CONTRACT_ABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "matchId", "type": "uint256" },
      { "internalType": "string", "name": "botId", "type": "string" }
    ],
    "name": "placeBet",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;

// --- COMPONENTS ---

function Prediction({ matchId }: { matchId: number | null }) {
  const { isConnected, address } = useAccount();
  const [botId, setBotId] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [status, setStatus] = useState('');
  
  const { writeContract, data: hash, error: writeError, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const handlePredict = async () => {
    if (!matchId && matchId !== 0) return alert('No active match');
    if (!botId) return alert('Enter Bot ID');
    if (!isConnected) return alert('Connect Wallet');
    
    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'placeBet',
        args: [BigInt(matchId || 0), botId],
        value: parseEther(amount),
      });
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  };

  useEffect(() => {
    if (isConfirming) setStatus('Confirming...');
    if (isConfirmed && hash) {
      setStatus('Confirmed! notifying server...');
      fetch('/api/bet/place', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, botId, amount, txHash: hash, bettor: address })
      }).then(res => res.json()).then(data => {
        setStatus(data.ok ? '✅ Prediction Placed' : '⚠️ Server Error');
      }).catch(() => setStatus('⚠️ Network Error'));
    }
    if (writeError) setStatus('Error: ' + writeError.message);
  }, [isConfirming, isConfirmed, writeError, hash, matchId, botId, amount, address]);

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Match</span><span>{matchId !== null ? `#${matchId}` : '--'}</span></div>
      <input placeholder="Bot Name" value={botId} onChange={e => setBotId(e.target.value)} />
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        {[0.001, 0.01, 0.1].map(val => (
          <button key={val} onClick={() => setAmount(val.toString())} style={{ flex: 1 }}>{val}E</button>
        ))}
      </div>
      <input placeholder="Custom Amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ marginTop: '6px' }} />
      <button onClick={handlePredict} disabled={isPending || isConfirming} style={{ marginTop: '6px' }}>
        {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : '🔮 Predict'}
      </button>
      <div className="muted" style={{ marginTop: '6px' }}>{status}</div>
    </div>
  );
}

function BotPanel() {
  const { isConnected } = useAccount();
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [regStatus, setRegStatus] = useState('');
  const { writeContract, data: regHash, isPending: regPending } = useWriteContract();
  const { isLoading: regConfirming, isSuccess: regConfirmed } = useWaitForTransactionReceipt({ hash: regHash });

  const guideText = 'read http://107.174.228.72:3000/SNAKE_GUIDE.md';
  
  const handleCopy = () => {
    navigator.clipboard.writeText(guideText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (regConfirmed && regHash && name) {
      fetch('/api/bot/register-unlimited', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: name, txHash: regHash })
      }).then(r => r.json()).then(d => {
        setRegStatus(d.ok ? '✅ Registered!' : '⚠️ ' + (d.error || 'Failed'));
      }).catch(() => setRegStatus('⚠️ Error'));
    }
  }, [regConfirmed, regHash, name]);

  const handleRegister = () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!name) return alert('Enter Bot Name first');
    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'placeBet',
        args: [BigInt(0), name],
        value: parseEther('0.01'),
      });
    } catch (e: any) {
      setRegStatus('Error: ' + e.message);
    }
  };
  
  return (
    <div className="panel-card">
      <div className="muted" style={{ marginBottom: '6px' }}>Click to copy instructions to your bot to make a snake bot and fight for you.</div>
      <div 
        className="copy-box" 
        onClick={handleCopy}
        style={{ 
          cursor: 'pointer', 
          padding: '10px', 
          background: '#0d0d20', 
          border: '1px solid var(--neon-blue)', 
          borderRadius: '6px',
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          color: 'var(--neon-green)',
          position: 'relative',
          userSelect: 'none',
          transition: 'border-color 0.2s',
        }}
      >
        📋 {guideText}
        {copied && (
          <span style={{ 
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'var(--neon-green)', color: '#000', padding: '2px 8px', borderRadius: '4px',
            fontSize: '0.75rem', fontWeight: 'bold'
          }}>Copied!</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
        <input placeholder="Bot Name / ID" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
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
      {regStatus && <div className="muted" style={{ marginTop: '4px' }}>{regStatus}</div>}
    </div>
  );
}

function CompetitiveEnter({ matchNumber }: { matchNumber: number }) {
  const { isConnected } = useAccount();
  const [botId, setBotId] = useState('');
  const [targetMatch, setTargetMatch] = useState('');
  const [status, setStatus] = useState('');
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isConfirmed && hash) {
      setStatus('⏳ Confirming entry...');
      fetch('/api/competitive/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, matchNumber: parseInt(targetMatch), txHash: hash })
      }).then(r => r.json()).then(data => {
        setStatus(data.ok ? '✅ Entry confirmed for match #' + targetMatch : '⚠️ ' + (data.error || 'Failed'));
      }).catch(() => setStatus('⚠️ Network Error'));
    }
  }, [isConfirmed, hash, botId, targetMatch]);

  const handleEnter = () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!botId) return alert('Enter Bot ID');
    const mn = parseInt(targetMatch);
    if (!mn || mn < matchNumber) return alert('Match number must be >= current match #' + matchNumber);
    
    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'placeBet',
        args: [BigInt(0), botId],
        value: parseEther('0.001'),
      });
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Current Match</span><span>#{matchNumber}</span></div>
      <input placeholder="Bot ID (e.g. bot_xxx)" value={botId} onChange={e => setBotId(e.target.value)} />
      <input 
        placeholder={`Target Match # (>= ${matchNumber})`}
        value={targetMatch} 
        onChange={e => setTargetMatch(e.target.value)} 
        style={{ marginTop: '6px' }}
        type="number"
      />
      <div className="muted" style={{ marginTop: '4px' }}>Cost: 0.001 ETH per entry</div>
      <button onClick={handleEnter} disabled={isPending || isConfirming} style={{ marginTop: '6px' }}>
        {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : '🎯 Enter Arena'}
      </button>
      {status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

function GameCanvas({ 
  mode, 
  setMatchId, 
  setPlayers, 
  setMatchNumber 
}: { 
  mode: 'performance' | 'competitive';
  setMatchId: (id: number | null) => void;
  setPlayers: (players: any[]) => void;
  setMatchNumber?: (n: number) => void;
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

  // Fetch room count for performance mode
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
        if (state.matchNumber && setMatchNumber) {
          setMatchNumber(state.matchNumber);
        }
        setMatchInfo((isCompetitive ? '⚔️ COMPETITIVE ' : '') + 'MATCH #' + (state.matchId || '?'));
        const alivePlayers = state.players || [];
        const waitingPlayers = (state.waitingPlayers || []).map((p: any) => ({ ...p, waiting: true }));
        setPlayers([...alivePlayers, ...waitingPlayers]);

        // Timer
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

        // Canvas
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const cellSize = canvas.width / 30;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Grid - slightly different color for competitive
        ctx.strokeStyle = isCompetitive ? '#1a1020' : '#1a1a2e';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 30; i++) {
            ctx.beginPath(); ctx.moveTo(i*cellSize, 0); ctx.lineTo(i*cellSize, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i*cellSize); ctx.lineTo(canvas.width, i*cellSize); ctx.stroke();
        }

        // Obstacles (competitive mode)
        if (state.obstacles && state.obstacles.length > 0) {
            for (const obs of state.obstacles) {
                if (obs.solid) {
                    // Solid obstacle - dark red
                    ctx.fillStyle = '#8b0000';
                    ctx.shadowColor = '#ff0000';
                    ctx.shadowBlur = 4;
                    ctx.fillRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                    ctx.shadowBlur = 0;
                    // Draw X pattern
                    ctx.strokeStyle = '#ff4444';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(obs.x * cellSize + 2, obs.y * cellSize + 2);
                    ctx.lineTo((obs.x + 1) * cellSize - 2, (obs.y + 1) * cellSize - 2);
                    ctx.moveTo((obs.x + 1) * cellSize - 2, obs.y * cellSize + 2);
                    ctx.lineTo(obs.x * cellSize + 2, (obs.y + 1) * cellSize - 2);
                    ctx.stroke();
                } else {
                    // Blinking obstacle - yellow flashing
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
                    // Warning border
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(obs.x * cellSize, obs.y * cellSize, cellSize, cellSize);
                }
            }
        }

        // Food
        ctx.fillStyle = '#ff0055';
        ctx.shadowColor = '#ff0055'; ctx.shadowBlur = 10;
        state.food.forEach((f: any) => {
            ctx.beginPath(); ctx.arc(f.x*cellSize+cellSize/2, f.y*cellSize+cellSize/2, cellSize/3, 0, Math.PI*2); ctx.fill();
        });
        ctx.shadowBlur = 0;

        // Players
        (state.players || []).forEach((p: any) => {
            if (!p.body || p.body.length === 0) return;
            
            const isBlinking = !p.alive && p.blinking;
            if (isBlinking && Math.floor(Date.now() / 500) % 2 === 0) return;

            ctx.fillStyle = p.color || '#00ff88';
            ctx.shadowColor = p.color || '#00ff88';
            ctx.shadowBlur = p.alive ? 8 : 0;
            ctx.globalAlpha = p.alive ? 1 : 0.4;

            // Body with name letters
            const pName = p.name || '';
            p.body.forEach((seg: any, i: number) => {
                if (i === 0) return; 
                ctx.fillRect(seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2);
                // Draw letter on each body segment
                const letterIdx = (i - 1) % pName.length;
                if (pName[letterIdx]) {
                    ctx.save();
                    ctx.fillStyle = '#000';
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = p.alive ? 0.8 : 0.3;
                    ctx.font = `bold ${Math.max(cellSize * 0.6, 8)}px Orbitron, monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(pName[letterIdx], seg.x * cellSize + cellSize/2, seg.y * cellSize + cellSize/2 + 1);
                    ctx.restore();
                    // Restore player color for next segment
                    ctx.fillStyle = p.color || '#00ff88';
                    ctx.shadowColor = p.color || '#00ff88';
                    ctx.shadowBlur = p.alive ? 8 : 0;
                    ctx.globalAlpha = p.alive ? 1 : 0.4;
                }
            });

            // Head (triangle)
            const head = p.body[0];
            const dir = p.direction || {x:1, y:0};
            const cx = head.x * cellSize + cellSize/2;
            const cy = head.y * cellSize + cellSize/2;
            const size = cellSize/2 - 1;

            ctx.beginPath();
            if (dir.x === 1) {
                ctx.moveTo(cx + size, cy);
                ctx.lineTo(cx - size, cy - size);
                ctx.lineTo(cx - size, cy + size);
            } else if (dir.x === -1) {
                ctx.moveTo(cx - size, cy);
                ctx.lineTo(cx + size, cy - size);
                ctx.lineTo(cx + size, cy + size);
            } else if (dir.y === -1) {
                ctx.moveTo(cx, cy - size);
                ctx.lineTo(cx - size, cy + size);
                ctx.lineTo(cx + size, cy + size);
            } else {
                ctx.moveTo(cx, cy + size);
                ctx.lineTo(cx - size, cy - size);
                ctx.lineTo(cx + size, cy - size);
            }
            ctx.closePath();
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
    };

    return () => { if (ws) ws.close(); };
  }, [setMatchId, setPlayers, selectedRoom, isCompetitive, setMatchNumber]);

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

function App() {
  const [matchId, setMatchId] = useState<number | null>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [activePage, setActivePage] = useState<'performance' | 'competitive' | 'leaderboard'>('performance');
  const [competitiveMatchNumber, setCompetitiveMatchNumber] = useState(1);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/leaderboard/global');
        if (!res.ok) return;
        const data = await res.json();
        setLeaderboard(data || []);
      } catch (e) {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const isCompetitive = activePage === 'competitive';

  // Clear state on tab switch to avoid stale data
  const switchPage = (page: typeof activePage) => {
    setPlayers([]);
    setMatchId(null);
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
              <div style={{ marginLeft: 'auto' }}>
                <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
              </div>
            </header>

            {activePage === 'leaderboard' ? (
              <div className="leaderboard-page">
                <div className="panel-section" style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
                  <h2 style={{ color: 'var(--neon-green)', textAlign: 'center' }}>🏆 Global Leaderboard</h2>
                  <ul className="fighter-list">
                    {leaderboard.map((p: any, i: number) => (
                      <li key={i} className="fighter-item alive">
                        <span className="fighter-name">
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}
                        </span>
                        <span className="fighter-length">{p.wins}W</span>
                      </li>
                    ))}
                    {leaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
                  </ul>
                </div>
              </div>
            ) : (
              <div className={`content`}>
                <aside className="left-panel">
                  <div className="panel-section">
                    <h3>🤖 Bot Management</h3>
                    <BotPanel />
                  </div>
                  <div className="panel-section">
                    <h3>🎯 Arena Entry</h3>
                    <CompetitiveEnter matchNumber={competitiveMatchNumber} />
                  </div>
                  <div className="panel-section">
                    <h3>🔮 Prediction</h3>
                    <Prediction matchId={matchId} />
                  </div>
                </aside>

                <GameCanvas 
                  key={activePage}
                  mode={activePage as any} 
                  setMatchId={setMatchId} 
                  setPlayers={setPlayers}
                  setMatchNumber={isCompetitive ? setCompetitiveMatchNumber : undefined}
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
                      <h3>🏆 Leaderboard</h3>
                      <ul className="fighter-list">
                        {leaderboard.slice(0, 10).map((p: any, i: number) => (
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
