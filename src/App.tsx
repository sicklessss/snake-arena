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
  projectId: 'YOUR_PROJECT_ID', // Replaced with a placeholder or public one if available
  chains: [baseSepolia],
  ssr: false, 
});

const queryClient = new QueryClient();

// --- CONTRACT ---
const CONTRACT_ADDRESS = "0xAf077e41644529AF966EBC9B49849c94cDf80EE2";
const RULES_TEXT = `游戏介绍

Snake Arena 是一个实时多人贪吃蛇竞技场，玩家或AI bot在同一张地图中比拼生存与吞噬。

为什么能赚钱
- 观众可以对比赛下注
- bot 开发者可以卖 bot 订阅/使用权（可选）

如何加入
1) 观看：直接打开网页观看比赛
2) 参赛：上传 bot 脚本并加入房间
3) 下注：连接钱包，选择 bot 与金额

---

规则概览

1) 地图与节奏
- 地图：30×30
- 回合：125ms/次（约8FPS）
- 每局：180秒
- 食物上限：5个

2) 出生与移动
- 固定出生点，初始长度=3
- 不能立刻反向
- 普通Bot无WS会随机移动

3) 生长
- 吃到食物：+1长度，+1分
- 没吃到：尾巴缩一格保持长度

4) 死亡
- 撞墙 / 自撞 / 撞尸体：死亡

5) 蛇对蛇
- 头对头：更长者生存；同长同死
- 头撞到别人身体：更长者“吃掉”对方一段；更短者死亡

6) 胜负
- 仅剩1条：胜
- 全灭：No Winner
- 时间到：存活且最长者胜
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

function Betting({ matchId }: { matchId: number | null }) {
  const { isConnected, address } = useAccount();
  const [botId, setBotId] = useState('');
  const [amount, setAmount] = useState('0.01');
  const [status, setStatus] = useState('');
  
  const { writeContract, data: hash, error: writeError, isPending } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  });

  const handleBet = async () => {
    if (!matchId) return alert('No active match');
    if (!botId) return alert('Enter Bot ID');
    if (!isConnected) return alert('Connect Wallet');
    
    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'placeBet',
        args: [BigInt(matchId), botId],
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
        body: JSON.stringify({
          matchId,
          botId,
          amount,
          txHash: hash,
          bettor: address
        })
      }).then(res => res.json()).then(data => {
        setStatus(data.ok ? '✅ Bet Placed' : '⚠️ Server Error');
      }).catch(() => setStatus('⚠️ Network Error'));
    }
    if (writeError) setStatus('Error: ' + writeError.message);
  }, [isConfirming, isConfirmed, writeError, hash, matchId, botId, amount, address]);

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Match</span><span>{matchId ? `#${matchId}` : '--'}</span></div>
      <input placeholder="Bot Name" value={botId} onChange={e => setBotId(e.target.value)} />
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        {[0.001, 0.01, 0.1].map(val => (
          <button key={val} onClick={() => setAmount(val.toString())} style={{ flex: 1 }}>{val}E</button>
        ))}
      </div>
      <input 
        placeholder="Custom Amount" 
        value={amount} 
        onChange={e => setAmount(e.target.value)} 
        style={{ marginTop: '6px' }}
      />
      <button onClick={handleBet} disabled={isPending || isConfirming} style={{ marginTop: '6px' }}>
        {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Place Bet'}
      </button>
      <div className="muted" style={{ marginTop: '6px' }}>{status}</div>
    </div>
  );
}

function BotPanel() {
  const [name, setName] = useState('');
  
  return (
    <div className="panel-card">
      <div className="muted">Copy instructions to your lobster to make a snake bot.</div>
      <div className="muted">read http://107.174.228.72:3000/SNAKE_GUIDE.md</div>
      <input placeholder="Bot Name" value={name} onChange={e => setName(e.target.value)} />
    </div>
  );
}

function GameCanvas({ setMatchId, setPlayers }: { setMatchId: (id: number | null) => void, setPlayers: (players: any[]) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Connecting...');
  const [overlay, setOverlay] = useState<React.ReactNode>(null);
  const [timer, setTimer] = useState('3:00');
  const [timerColor, setTimerColor] = useState('#ff8800');
  const [matchInfo, setMatchInfo] = useState('ARENA: --');
  const [selectedRoom, setSelectedRoom] = useState(1);
  const [roomCount, setRoomCount] = useState(1);

  // Fetch room count periodically
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${proto}://${window.location.host}?arenaId=performance-${selectedRoom}`; 
    
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
        setMatchInfo('MATCH #' + (state.matchId || '?'));
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
        
        // Grid
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 30; i++) {
            ctx.beginPath(); ctx.moveTo(i*cellSize, 0); ctx.lineTo(i*cellSize, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i*cellSize); ctx.lineTo(canvas.width, i*cellSize); ctx.stroke();
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
            
            // Dead/Blink
            const isBlinking = !p.alive && p.blinking;
            if (isBlinking && Math.floor(Date.now() / 500) % 2 === 0) return;

            ctx.fillStyle = p.color || '#00ff88';
            ctx.shadowColor = p.color || '#00ff88';
            ctx.shadowBlur = p.alive ? 8 : 0;
            ctx.globalAlpha = p.alive ? 1 : 0.4;

            // Body
            p.body.forEach((seg: any, i: number) => {
                if (i === 0) return; 
                ctx.fillRect(seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2);
            });

            // Head
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
  }, [setMatchId, setPlayers, selectedRoom]);

  return (
    <div className="main-stage">
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
        <div className="match-info">{matchInfo}</div>
        <div className="timer" style={{ color: timerColor }}>{timer}</div>
        <div className="canvas-wrap">
          <canvas ref={canvasRef} width={600} height={600} style={{ border: '4px solid var(--neon-blue)', background: '#000', maxWidth: '90%', maxHeight: '70vh' }}></canvas>
          <div id="overlay">{overlay}</div>
        </div>
        <div className="status-bar">{status}</div>
        <div className="rules-wrap">
          <h3>📜 游戏规则</h3>
          <div className="rules-box">{RULES_TEXT}</div>
        </div>
    </div>
  );
}

function App() {
  const [matchId, setMatchId] = useState<number | null>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [mobilePage, setMobilePage] = useState<'main' | 'stats'>('main');

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

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <div className="app">
            <header className="top-tabs">
              <button className={`tab ${mobilePage === 'main' ? 'active' : ''}`} onClick={() => setMobilePage('main')}>主面板</button>
              <button className={`tab ${mobilePage === 'stats' ? 'active' : ''}`} onClick={() => setMobilePage('stats')}>排行榜</button>
              <div style={{ marginLeft: 'auto' }}>
                <ConnectButton showBalance={false} chainStatus="icon" accountStatus="avatar" />
              </div>
            </header>

            <div className={`content ${mobilePage === 'stats' ? 'mobile-stats' : 'mobile-main'}`}>
              <aside className="left-panel">
                <div className="panel-section">
                  <h3>🤖 Bot Management</h3>
                  <BotPanel />
                </div>
                <div className="panel-section">
                  <h3>🔮 Betting</h3>
                  <Betting matchId={matchId} />
                </div>
              </aside>

              <GameCanvas setMatchId={setMatchId} setPlayers={setPlayers} />

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
                      {leaderboard.map((p: any, i: number) => (
                        <li key={i} className="fighter-item">
                          <span className="fighter-name">{p.name}</span>
                          <span className="fighter-length">{p.wins}W</span>
                        </li>
                      ))}
                    </ul>
                </div>

              </aside>
            </div>
          </div>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;
