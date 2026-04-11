'use client';
import { useState, useEffect } from 'react';

function StatusDot({ status }) {
  let color = 'var(--status-err)';
  if (status === 'ok') color = 'var(--status-ok)';
  if (status === 'warn') color = 'var(--status-warn)';
  return <span className="status-dot" style={{ width: 6, height: 6, background: color, boxShadow: `0 0 6px ${color}` }}></span>;
}

export default function AgentCard({ identity: id, onIgnite, onBackup, onTerminate, onRefresh, showToast, adapters = [], isRetired, onRetire, onRestore, onDownloadArchive, onObliterate, isRunning = false, liveRun, onViewLogs = () => {} }) {
  const [expanded, setExpanded] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [health, setHealth] = useState(null);
  const [isEditingSoul, setIsEditingSoul] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [savingSoul, setSavingSoul] = useState(false);

  // Run health check on mount
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: id.role, apiUrl: id.apiUrl })
        });
        const data = await res.json();
        if (data.success) setHealth(data);
      } catch { /* silent */ }
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [id.role, id.apiUrl]);

  const handleSwitch = async (field, value) => {
    setSwitching(true);
    try {
      const body = { role: id.role };
      body[field] = value;
      const res = await fetch('/api/identity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        onRefresh();
        showToast(`Switched ${field} to ${value}`, false);
        if (isRunning) {
          showToast(`Restarting worker to apply ${field}...`, false);
          await onTerminate();
          await onIgnite();
        }
      } else {
        showToast('Switch failed: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
    setSwitching(false);
  };

  const timeoutMin = Math.round((id.timeoutMs || 1800000) / 60000);

  const handleOpenSoul = async () => {
    setIsEditingSoul(true);
    setSoulContent('Loading...');
    try {
      const res = await fetch(`/api/identity/instructions?role=${id.role}`);
      const data = await res.json();
      if (data.success) {
        setSoulContent(data.soul);
      } else {
        setSoulContent(`Error loading SOUL: ${data.error}`);
      }
    } catch (e) {
      setSoulContent('Network error.');
    }
  };

  const handleSaveSoul = async () => {
    setSavingSoul(true);
    try {
      const res = await fetch('/api/identity/instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: id.role, soul: soulContent })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Agent SOUL.md saved successfully', false);
        setIsEditingSoul(false);
      } else {
        showToast('Failed to save SOUL: ' + data.error, true);
      }
    } catch (e) {
       showToast('Error saving: ' + String(e), true);
    }
    setSavingSoul(false);
  };

  return (
    <div className="agent-card flex-col" style={{ alignItems: 'stretch', gap: 'var(--space-md)' }}>
      {/* Row 1: Header */}
      <div className="flex items-center justify-between" style={{ padding: '4px 0' }}>
        <div className="flex items-center gap-md">
          <div onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px', marginLeft: '-4px' }} title="Toggle configuration">
            <svg className="agent-card__chevron" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div className="flex items-center gap-md">
            <h3 style={{ fontSize: '16px', margin: 0, fontWeight: 600 }}>{id.role.toUpperCase()}</h3>
            <div className="flex items-center gap-sm" onClick={e => e.stopPropagation()} style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              <span style={{ userSelect: 'none' }}>via</span>
              <select 
                 className="agent-card__inline-select" 
                 style={{ border: 'none', borderBottom: '1px dashed var(--text-muted)', background: 'transparent', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', outline: 'none', padding: '0 2px' }} 
                 value={id.executor || adapters[0]} 
                 disabled={switching} 
                 onChange={e => handleSwitch('executor', e.target.value)}
              >
                {adapters.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              
              <span style={{ color: 'var(--border-interactive)', userSelect: 'none' }}>/</span>
              
              <input
                 style={{ border: 'none', borderBottom: '1px dashed var(--text-muted)', background: 'transparent', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, outline: 'none', width: '80px', padding: '0 2px' }}
                 placeholder="model: auto"
                 defaultValue={id.model || ''}
                 disabled={switching}
                 onBlur={e => handleSwitch('model', e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                 title="Hit Enter or unfocus to apply"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-sm" onClick={e => e.stopPropagation()}>
          {!isRetired ? (
            <>
              <button
                className={isRunning ? 'btn-outline' : 'btn-primary'}
                onClick={onIgnite}
                disabled={isRunning}
                style={isRunning ? { color: 'var(--status-ok)', borderColor: 'var(--status-ok)', opacity: 0.7, cursor: 'not-allowed' } : {}}
              >
                {isRunning ? '⚡ Running' : 'Ignite'}
              </button>
              <button className="btn-outline" onClick={onTerminate} disabled={!isRunning} style={!isRunning ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>Stop</button>
            </>
          ) : (
             <span style={{ fontSize: 13, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', padding: '2px 10px', borderRadius: 'var(--radius-sm)' }}>♻️ Retired</span>
          )}
        </div>
      </div>

      {isRunning && !isRetired && (
        <div className="agent-card__live-strip">
          <div className="flex gap-md items-center">
            <div className="flex items-center gap-sm">
               <StatusDot status={liveRun ? (liveRun.status === 'error' ? 'err' : 'warn') : 'ok'} />
               <span className="agent-card__live-label" style={liveRun?.status === 'error' ? { color: 'var(--status-err)' } : {}}>
                 {liveRun ? (liveRun.status === 'error' ? 'FAULTED' : 'LIVE TASK') : 'AWAITING DISPATCH'}
               </span>
            </div>
            <span className="agent-card__live-task" style={liveRun?.status === 'error' ? { color: 'var(--status-err)' } : {}}>
              {liveRun ? (liveRun.error || liveRun.statusMessage || liveRun.currentTask || liveRun.status || 'Processing...') : 'Idling...'}
            </span>
            <button className="btn-outline agent-card__logs-btn" onClick={(e) => { e.stopPropagation(); onViewLogs(id.role); }}>
              _logs
            </button>
          </div>
        </div>
      )}

      {expanded && !isEditingSoul && (
        <div className="flex flex-col gap-md">

      {/* Row 2: Config grid */}
      <div className="agent-card__config-grid">

        <div>
          <label>API Server</label>
          <div className="agent-card__val agent-card__val--ok">{id.apiUrl || 'local'}</div>
        </div>

        <div>
          <label>Company</label>
          <div className="agent-card__val agent-card__val--mono">{id.companyId ? id.companyId.substring(0, 12) + '…' : '—'}</div>
        </div>

        <div>
          <label>Timeout</label>
          <div className="agent-card__val">{timeoutMin} min</div>
        </div>

        <div>
          <label>Agent ID</label>
          <div className="agent-card__val agent-card__val--mono" title={id.agentId || ''} style={{ cursor: 'text', userSelect: 'all' }}>
            {id.agentId ? (id.agentId.length > 15 ? id.agentId.substring(0, 15) + '…' : id.agentId) : '—'}
          </div>
        </div>

        <div>
          <label>Status</label>
          <div className="flex items-center gap-sm">
            <StatusDot status="ok" />
            <span className="agent-card__val">Ready</span>
          </div>
        </div>
      </div>

      {/* Row 3: Health Checks */}
      <div className="agent-card__health-grid">
        <div>
          <label>Local Connection</label>
          {health ? (
            <div className="flex flex-col gap-sm">
              <div className="flex items-center gap-sm">
                <StatusDot status={health.local.identity ? 'ok' : 'err'} />
                <span className="agent-card__health-text" style={{ color: health.local.identity ? 'var(--text-secondary)' : 'var(--status-err)' }}>
                  Identity File {health.local.identity ? '✓' : '✗ Missing'}
                </span>
              </div>
              <div className="flex items-center gap-sm">
                <StatusDot status={health.local.workspace ? 'ok' : 'warn'} />
                <span className="agent-card__health-text" style={{ color: health.local.workspace ? 'var(--text-secondary)' : 'var(--status-warn)' }}>
                  Sandbox Dir {health.local.workspace ? '✓' : '✗ Uncreated'}
                </span>
              </div>
            </div>
          ) : (
            <span className="agent-card__health-text agent-card__health-text--muted">Checking...</span>
          )}
        </div>
        <div>
          <label>Remote Connection</label>
          {health ? (
            <div className="flex flex-col gap-sm">
              <div className="flex items-center gap-sm">
                <StatusDot status={health.remote.reachable ? 'ok' : 'err'} />
                <span className="agent-card__health-text" style={{ color: health.remote.reachable ? 'var(--status-ok)' : 'var(--status-err)' }}>
                  {health.remote.reachable ? 'Connected' : 'Unreachable'}
                </span>
              </div>
              {health.remote.latencyMs !== null && (
                <span className="agent-card__latency">
                  Latency: {health.remote.latencyMs}ms
                  {health.remote.error ? ` — ${health.remote.error}` : ''}
                </span>
              )}
            </div>
          ) : (
            <span className="agent-card__health-text agent-card__health-text--muted">Checking...</span>
          )}
        </div>
      </div>

      {/* Row 4: Advanced Actions */}
      <div className="flex gap-sm" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-md)' }}>
         {!isRetired ? (
            <>
              <button className="btn-outline" onClick={handleOpenSoul}>Edit SOUL</button>
              <button className="btn-outline" onClick={onBackup}>Backup</button>
              <div style={{ flex: 1 }} />
              {confirmRetire ? (
                <button 
                  className="btn-danger" 
                  onClick={() => { setConfirmRetire(false); onRetire(); }}
                  onMouseLeave={() => setConfirmRetire(false)}
                >
                  Sure? ♻️
                </button>
              ) : (
                <button className="btn-danger" onClick={() => setConfirmRetire(true)}>Retire ♻️</button>
              )}
            </>
         ) : (
            <>
              <button className="btn-primary" onClick={onRestore}>Restore to Active</button>
              <button className="btn-outline" onClick={onDownloadArchive}>Download 📥</button>
              <div style={{ flex: 1 }} />
              {confirmRetire ? (
                <button 
                  className="btn-danger" 
                  onClick={() => { setConfirmRetire(false); onObliterate(); }}
                  onMouseLeave={() => setConfirmRetire(false)}
                >
                  Sure? 💀
                </button>
              ) : (
                <button className="btn-danger" onClick={() => setConfirmRetire(true)}>Obliterate 💀</button>
              )}
            </>
         )}
      </div>

      </div>
      )}

      {expanded && isEditingSoul && (
        <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--bg-base)', border: '1px solid var(--border-interactive)', borderRadius: 'var(--radius-md)' }} onClick={e => e.stopPropagation()}>
           <h4 style={{ margin: '0 0 var(--space-sm) 0', color: 'var(--text-primary)', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
             📝 Edit Agent Identity (SOUL.md)
             <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>workspace: {id.role}</span>
           </h4>
           <textarea 
             value={soulContent} 
             onChange={(e) => setSoulContent(e.target.value)}
             style={{ width: '100%', height: 250, fontFamily: 'monospace', fontSize: 12, padding: 'var(--space-sm)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}
             disabled={savingSoul}
           />
           <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
             <button onClick={() => setIsEditingSoul(false)} className="btn-outline" disabled={savingSoul}>Cancel</button>
             <button onClick={handleSaveSoul} className="btn-primary" disabled={savingSoul}>{savingSoul ? 'Saving...' : 'Save Instructions'}</button>
           </div>
        </div>
      )}
    </div>
  );
}
