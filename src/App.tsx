import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, stringToHex } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import './index.css';
import { CONTRACTS, BOT_REGISTRY_ABI, REWARD_DISTRIBUTOR_ABI, PARI_MUTUEL_ABI } from './contracts';

const config = getDefaultConfig({ appName: 'Snake Arena', projectId: 'YOUR_PROJECT_ID', chains: [baseSepolia], ssr: false });
const queryClient = new QueryClient();

function stringToBytes32(str: string): `0x${string}` { return stringToHex(str.padEnd(32, '\0').slice(0, 32), { size: 32 }); }

// Original Bot Panel with Register/Sell logic
function BotPanel() {
  const { isConnected, address } = useAccount();
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [regStatus, setRegStatus] = useState('');
  const [regFee, setRegFee] = useState('0.01');
  const [botInfo, setBotInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [sellPrice, setSellPrice] = useState('');
  
  const { writeContract: registerBot, data: regHash, isPending: regPending } = useWriteContract();
  const { writeContract: listForSale, data: sellHash, isPending: sellPending } = useWriteContract();
  const { writeContract: claimRewards, isPending: claimPending } = useWriteContract();
  const { isSuccess: regConfirmed } = useWaitForTransactionReceipt({ hash: regHash });
  const { isSuccess: sellConfirmed } = useWaitForTransactionReceipt({ hash: sellHash });

  const guideText = 'read http://107.174.228.72:3000/SNAKE_GUIDE.md';
  
  // Fetch registration fee
  useEffect(() => {
    fetch('/api/bot/registration-fee').then(r => r.json()).then(d => d.fee && setRegFee(d.fee)).catch(() => {});
  }, []);

  // Fetch bot info when name changes
  useEffect(() => {
    if (!name) { setBotInfo(null); return; }
    const fetchBotInfo = async () => {
      setLoading(true);
      try {
        // First try to get from chain
        const res = await fetch(`/api/bot/onchain/${name}`);
        if (res.ok) {
          const data = await res.json();
          setBotInfo(data);
        } else {
          // Bot not registered on chain yet
          setBotInfo({ botName: name, registered: false, owner: null });
        }
      } catch (e) {
        setBotInfo({ botName: name, registered: false, owner: null });
      }
      setLoading(false);
    };
    const timer = setTimeout(fetchBotInfo, 500);
    return () => clearTimeout(timer);
  }, [name]);

  useEffect(() => { if (regConfirmed) { setRegStatus('✅ Registered!'); setBotInfo({ ...botInfo, registered: true, owner: address }); } }, [regConfirmed, address]);
  useEffect(() => { if (sellConfirmed) { setShowSell(false); setBotInfo({ ...botInfo, forSale: true, salePrice: sellPrice }); } }, [sellConfirmed]);
  
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

  const handleRegister = () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!name) return alert('Enter Bot Name first');
    setRegStatus('Registering...');
    registerBot({
      address: CONTRACTS.botRegistry as `0x${string}`,
      abi: BOT_REGISTRY_ABI,
      functionName: 'registerBot',
      args: [stringToHex(name.padEnd(32, '\0').slice(0, 32), { size: 32 })],
      value: parseEther(regFee),
    });
  };

  const handleSell = () => {
    const price = parseFloat(sellPrice);
    if (!price || price <= 0) return alert('Enter valid price');
    listForSale({
      address: CONTRACTS.botRegistry as `0x${string}`,
      abi: BOT_REGISTRY_ABI,
      functionName: 'listForSale',
      args: [stringToHex(name.padEnd(32, '\0').slice(0, 32), { size: 32 }), parseEther(sellPrice)],
    });
  };

  const handleClaim = () => {
    if (!name) return;
    claimRewards({
      address: CONTRACTS.rewardDistributor as `0x${string}`,
      abi: REWARD_DISTRIBUTOR_ABI,
      functionName: 'claimRewards',
      args: [stringToHex(name.padEnd(32, '\0').slice(0, 32), { size: 32 })],
    });
  };
  
  const isOwner = botInfo?.owner?.toLowerCase() === address?.toLowerCase();
  const showRegister = botInfo && !botInfo.registered;
  const showSellButton = botInfo && botInfo.registered && isOwner && !botInfo.forSale;
  const showCancelSell = botInfo && botInfo.registered && isOwner && botInfo.forSale;

  return (
    <div className="panel-card">
      <div style={{ marginBottom: '6px', color: '#fff', fontSize: '0.85rem' }}>Click to copy instructions to your bot to make a snake bot and fight for you.</div>
      <div 
        className="copy-box" 
        onClick={handleCopy}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && handleCopy()}
        style={{ 
          cursor: 'pointer', 
          padding: '10px 12px', 
          background: '#0d0d20', 
          border: '1px solid var(--neon-blue)', 
          borderRadius: '6px',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          color: 'var(--neon-green)',
          position: 'relative',
          userSelect: 'all',
          transition: 'border-color 0.2s, background 0.2s',
          wordBreak: 'break-all' as const,
          lineHeight: '1.4',
        }}
      >
        📋 {guideText}
        {copied && (
          <span style={{ 
            position: 'absolute', right: 8, top: '-28px',
            background: 'var(--neon-green)', color: '#000', padding: '3px 10px', borderRadius: '4px',
            fontSize: '0.75rem', fontWeight: 'bold', pointerEvents: 'none',
            boxShadow: '0 2px 8px rgba(0,255,136,0.4)',
            zIndex: 10,
          }}>✅ Copied!</span>
        )}
      </div>
      
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
        <input placeholder="Bot Name / ID" value={name} onChange={e => setName(e.target.value)} style={{ flex: 1 }} />
        
        {loading ? (
          <span style={{ fontSize: '0.75rem', color: '#888' }}>⏳</span>
        ) : showRegister ? (
          <button 
            onClick={handleRegister} 
            disabled={regPending || !isConnected}
            style={{ width: 'auto', padding: '8px 12px', margin: 0, background: 'var(--neon-pink)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
          >
            {regPending ? '...' : `💎 Register ${regFee}E`}
          </button>
        ) : showSellButton ? (
          <button 
            onClick={() => setShowSell(true)}
            style={{ width: 'auto', padding: '8px 12px', margin: 0, background: 'var(--neon-blue)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
          >
            Sell
          </button>
        ) : showCancelSell ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--neon-pink)' }}>🏷️ Listed</span>
        ) : botInfo?.registered && !isOwner ? (
          <span style={{ fontSize: '0.75rem', color: '#888' }}>Not owned</span>
        ) : null}
      </div>
      
      {regStatus && <div className="muted" style={{ marginTop: '4px' }}>{regStatus}</div>}
      
      {botInfo?.registered && parseFloat(botInfo.pendingRewards || '0') > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8rem' }}>💰 {parseFloat(botInfo.pendingRewards).toFixed(4)} ETH</span>
          {botInfo.canClaim && (
            <button onClick={handleClaim} disabled={claimPending} style={{ fontSize: '0.7rem', padding: '4px 8px' }}>
              {claimPending ? '...' : 'Claim'}
            </button>
          )}
        </div>
      )}
      
      {showSell && (
        <div style={{ marginTop: '10px', padding: '10px', background: '#1a1a2e', borderRadius: '6px' }}>
          <input type="number" placeholder="Price in ETH" value={sellPrice} onChange={e => setSellPrice(e.target.value)} step="0.001" min="0.001" style={{ marginBottom: '6px' }} />
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => setShowSell(false)} style={{ flex: 1, fontSize: '0.75rem' }}>Cancel</button>
            <button onClick={handleSell} disabled={sellPending} style={{ flex: 1, fontSize: '0.75rem' }}>{sellPending ? 'Listing...' : 'List for Sale'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Marketplace
function MarketplacePanel() {
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch(`/api/marketplace/listings?offset=0&limit=20`); if (!res.ok) throw new Error('Failed'); const data = await res.json(); setListings(data.listings || []); } catch (e) {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchListings(); const interval = setInterval(fetchListings, 60000); return () => clearInterval(interval); }, [fetchListings]);

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>🏪 Bot Marketplace</h2>
        <button onClick={fetchListings} disabled={loading} style={{ fontSize: '0.8rem', padding: '6px 12px' }}>{loading ? '⟳' : '↻ Refresh'}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {listings.length === 0 ? <div style={{ textAlign: 'center', color: '#666', padding: '40px' }}>No bots for sale yet</div> : listings.map(bot => <MarketplaceCard key={bot.botId} bot={bot} onSuccess={fetchListings} />)}
      </div>
    </div>
  );
}

function MarketplaceCard({ bot, onSuccess }: { bot: any; onSuccess: () => void }) {
  const { isConnected } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });
  const [status, setStatus] = useState('');

  useEffect(() => { if (isConfirmed) { setStatus('✅ Purchase successful!'); setTimeout(onSuccess, 1500); } }, [isConfirmed, onSuccess]);

  const handleBuy = () => {
    if (!isConnected) return alert('Connect Wallet');
    setStatus('Buying...');
    writeContract({ address: CONTRACTS.botRegistry as `0x${string}`, abi: BOT_REGISTRY_ABI, functionName: 'buyBot', args: [stringToBytes32(bot.botId)], value: parseEther(bot.price) });
  };

  return (
    <div style={{ border: '1px solid var(--neon-blue)', borderRadius: '8px', padding: '16px', background: 'rgba(0,0,0,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{bot.botName}</span>
        <span style={{ color: 'var(--neon-green)', fontWeight: 'bold' }}>{bot.price} ETH</span>
      </div>
      <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '12px' }}>
        <div>🏆 {bot.matchesPlayed} matches played</div>
        <div>💰 {parseFloat(bot.totalEarnings).toFixed(3)} ETH earned</div>
      </div>
      <button onClick={handleBuy} disabled={isPending} style={{ width: '100%', fontSize: '0.85rem' }}>{isPending ? 'Processing...' : 'Buy Now'}</button>
      {status && <div style={{ fontSize: '0.8rem', marginTop: '8px', textAlign: 'center' }}>{status}</div>}
    </div>
  );
}

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
    try { writeContract({ address: CONTRACTS.pariMutuel as `0x${string}`, abi: PARI_MUTUEL_ABI, functionName: 'placeBet', args: [BigInt(matchId || 0), stringToBytes32(botId)], value: parseEther(amount) }); }
    catch (e: any) { setStatus('Error: ' + e.message); }
  };

  useEffect(() => {
    if (isConfirming) setStatus('Confirming...');
    if (isConfirmed && hash) {
      setStatus('Confirmed! notifying server...');
      fetch('/api/bet/place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId, botId, amount, txHash: hash, bettor: address }) })
        .then(res => res.json()).then(data => { setStatus(data.ok ? '✅ Prediction Placed' : '⚠️ Server Error'); }).catch(() => setStatus('⚠️ Network Error'));
    }
    if (writeError) setStatus('Error: ' + writeError.message);
  }, [isConfirming, isConfirmed, writeError, hash, matchId, botId, amount, address]);

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Match</span><span>{matchId !== null ? `#${matchId}` : '--'}</span></div>
      <input placeholder="Bot Name" value={botId} onChange={e => setBotId(e.target.value)} />
      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        {[0.001, 0.01, 0.1].map(val => <button key={val} onClick={() => setAmount(val.toString())} style={{ flex: 1 }}>{val}E</button>)}
      </div>
      <input placeholder="Custom Amount" value={amount} onChange={e => setAmount(e.target.value)} style={{ marginTop: '6px' }} />
      <button onClick={handlePredict} disabled={isPending || isConfirming} style={{ marginTop: '6px' }}>{isPending ? 'Signing...' : isConfirming ? 'Confirming...' : '🔮 Predict'}</button>
      <div className="muted" style={{ marginTop: '6px' }}>{status}</div>
    </div>
  );
}

function CompetitiveEnter({ matchNumber }: { matchNumber: number }) {
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
      fetch('/api/competitive/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botId: resolvedBotId, matchNumber: parseInt(targetMatch), txHash: hash }) })
        .then(r => r.json()).then(data => { setStatus(data.ok ? '✅ Entry confirmed for match #' + targetMatch : '⚠️ ' + (data.error || 'Failed')); }).catch(() => setStatus('⚠️ Network Error'));
    }
  }, [isConfirmed, hash, resolvedBotId, targetMatch]);

  const handleEnter = async () => {
    if (!isConnected) return alert('Connect Wallet');
    if (!botName) return alert('Enter Bot Name');
    const mn = parseInt(targetMatch);
    if (isNaN(mn) || mn < matchNumber) return alert('Match number must be >= current match #' + matchNumber);
    try {
      setStatus('Looking up bot...');
      const res = await fetch('/api/bot/lookup?name=' + encodeURIComponent(botName));
      if (!res.ok) { const err = await res.json(); setStatus('⚠️ ' + (err.error === 'bot_not_found' ? 'Bot "' + botName + '" not found' : err.error)); return; }
      const data = await res.json();
      setResolvedBotId(data.botId);
      writeContract({ address: CONTRACTS.pariMutuel as `0x${string}`, abi: PARI_MUTUEL_ABI, functionName: 'placeBet', args: [BigInt(0), stringToBytes32(data.botId)], value: parseEther('0.001') });
    } catch (e: any) { setStatus('Error: ' + e.message); }
  };

  return (
    <div className="panel-card">
      <div className="panel-row"><span>Current Match</span><span>#{matchNumber}</span></div>
      <input placeholder="Bot Name" value={botName} onChange={e => setBotName(e.target.value)} />
      <input placeholder={`Target Match # (>= ${matchNumber})`} value={targetMatch} onChange={e => setTargetMatch(e.target.value)} style={{ marginTop: '6px' }} type="number" />
      <div className="muted" style={{ marginTop: '4px' }}>Cost: 0.001 ETH per entry</div>
      <button onClick={handleEnter} disabled={isPending || isConfirming} style={{ marginTop: '6px' }}>{isPending ? 'Signing...' : isConfirming ? 'Confirming...' : '🎯 Enter Arena'}</button>
      {status && <div className="muted" style={{ marginTop: '6px' }}>{status}</div>}
    </div>
  );
}

function GameCanvas({ mode, setMatchId, setPlayers, setMatchNumber }: { mode: 'performance' | 'competitive'; setMatchId: (id: number | null) => void; setPlayers: (players: any[]) => void; setMatchNumber?: (n: number) => void; }) {
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
    const fetchRooms = async () => { try { const res = await fetch('/api/arena/status'); const data = await res.json(); setRoomCount(data.performance?.length || 1); } catch {} };
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
      ws.onmessage = (e) => { const msg = JSON.parse(e.data); if (msg.type === 'update') render(msg.state); };
    };
    connect();
    const render = (state: any) => {
      setMatchId(state.matchId);
      if (state.matchNumber && setMatchNumber) setMatchNumber(state.matchNumber);
      setMatchInfo((isCompetitive ? '⚔️ COMPETITIVE ' : '') + 'MATCH #' + (state.matchId || '?'));
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
        setOverlay(<><div className="overlay-text">🏆</div><div className="overlay-text">{state.winner || 'NO WINNER'}</div></>);
      } else if (state.victoryPause) {
        const winner = state.players.find((p: any) => p.alive);
        setOverlay(<><div className="overlay-text">🏆</div><div className="overlay-text">{winner ? winner.name : ''} WINS!</div></>);
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
      state.food.forEach((f: any) => { ctx.beginPath(); ctx.arc(f.x*cellSize+cellSize/2, f.y*cellSize+cellSize/2, cellSize/3, 0, Math.PI*2); ctx.fill(); });
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
        if (dir.x === 1) { ctx.moveTo(cx + size, cy); ctx.lineTo(cx - size, cy - size); ctx.lineTo(cx - size, cy + size); }
        else if (dir.x === -1) { ctx.moveTo(cx - size, cy); ctx.lineTo(cx + size, cy - size); ctx.lineTo(cx + size, cy + size); }
        else if (dir.y === -1) { ctx.moveTo(cx, cy - size); ctx.lineTo(cx - size, cy + size); ctx.lineTo(cx + size, cy + size); }
        else { ctx.moveTo(cx, cy + size); ctx.lineTo(cx - size, cy - size); ctx.lineTo(cx + size, cy - size); }
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
              <button key={n} className={`room-btn ${selectedRoom === n ? 'active' : ''} ${n > roomCount ? 'disabled' : ''}`} onClick={() => n <= roomCount && setSelectedRoom(n)} disabled={n > roomCount}>{n}</button>
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
    </div>
  );
}

// Main App
function App() {
  const [matchId, setMatchId] = useState<number | null>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [perfLeaderboard, setPerfLeaderboard] = useState<any[]>([]);
  const [compLeaderboard, setCompLeaderboard] = useState<any[]>([]);
  const [activePage, setActivePage] = useState<'performance' | 'competitive' | 'leaderboard' | 'marketplace'>('performance');
  const [competitiveMatchNumber, setCompetitiveMatchNumber] = useState(0);

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
              <button className={`tab ${activePage === 'marketplace' ? 'active' : ''}`} onClick={() => switchPage('marketplace')}>🏪 市场</button>
              <button className={`tab ${activePage === 'leaderboard' ? 'active' : ''}`} onClick={() => switchPage('leaderboard')}>🏆 排行榜</button>
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
                          <span className="fighter-name">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}</span>
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
                          <span className="fighter-name">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} {p.name}</span>
                          <span className="fighter-length">{p.wins}W</span>
                        </li>
                      ))}
                      {compLeaderboard.length === 0 && <li className="fighter-item"><span className="muted">No data yet</span></li>}
                    </ul>
                  </div>
                </div>
              </div>
            ) : activePage === 'marketplace' ? (
              <MarketplacePanel />
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
                  setMatchId={throttledSetMatchId} 
                  setPlayers={throttledSetPlayers}
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
