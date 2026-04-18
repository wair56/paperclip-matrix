'use client';
import { useState, useEffect } from 'react';
import { parseEnvText } from '@/lib/cliEnv';

function StatusDot({ status }) {
  let color = 'var(--status-err)';
  if (status === 'ok') color = 'var(--status-ok)';
  if (status === 'warn') color = 'var(--status-warn)';
  return <span className="status-dot" style={{ width: 6, height: 6, background: color, boxShadow: `0 0 6px ${color}` }}></span>;
}

export default function AgentCard({ identity: id, onIgnite, onBackup, onTerminate, onRefresh, showToast, adapters = [], isRetired, isRetiring = false, isObliterating = false, onRetire, onRestore, onDownloadArchive, onObliterate, isRunning = false, liveRun, onViewLogs = () => {} }) {
  const [expanded, setExpanded] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [health, setHealth] = useState(null);
  const [isEditingSoul, setIsEditingSoul] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [savingSoul, setSavingSoul] = useState(false);
  const [supportedModels, setSupportedModels] = useState([]);
  const [isTesting, setIsTesting] = useState(false);
  const [testResponse, setTestResponse] = useState(null);
  const [modelInput, setModelInput] = useState(null);
  const [envText, setEnvText] = useState(id.envText || '');
  const [savingEnv, setSavingEnv] = useState(false);
  const effectiveModelInput = modelInput === null ? (id.model || '') : modelInput;
  const parsedEnv = parseEnvText(envText || '');

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

  // Fetch supported models for this agent's executor on mount
  useEffect(() => {
    if (!id.executor) return;
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/adapters/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adapter: id.executor })
        });
        const data = await res.json();
        if (data.success && data.models) {
          setSupportedModels(data.models);
        }
      } catch (e) { console.error('Failed to fetch models', e); }
    };
    fetchModels();
  }, [id.executor]);

  const handleSwitch = async (field, value) => {
    // Skip if value is unchanged
    const currentVal = id[field] ?? '';
    if (String(value).trim() === String(currentVal).trim()) return;

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
        setModelInput(null);
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

  const handleTestAgent = async () => {
    setIsTesting(true);
    setTestResponse(null);
    try {
      const res = await fetch('/api/identity/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: id.role })
      });
      const data = await res.json();
      if (data.success) {
        setTestResponse({ success: true, text: data.response, meta: [data.executor, data.model].filter(Boolean).join(' · ') });
      } else {
        const detail = [data.error, data.stderr].filter(Boolean).join('\n');
        setTestResponse({ success: false, text: detail || 'Unknown error' });
      }
    } catch (e) {
      setTestResponse({ success: false, text: 'Network error or timeout.' });
    }
    setIsTesting(false);
  };

  const handleSaveEnv = async () => {
    setSavingEnv(true);
    try {
      const res = await fetch('/api/identity', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: id.role, envText }),
      });
      const data = await res.json();
      if (data.success) {
        setEnvText(data.envText ?? envText);
        onRefresh();
        if (data.warnings?.length > 0) {
          showToast(`已保存，但有 ${data.warnings.length} 行格式无法解析`, true);
        } else {
          showToast('Agent runtime env overrides 已保存', false);
        }
      } else {
        showToast(`保存 env 失败: ${data.error}`, true);
      }
    } catch (e) {
      showToast(`保存 env 失败: ${e.message}`, true);
    }
    setSavingEnv(false);
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
            <div className="flex items-center gap-sm">
              <input 
                style={{ fontSize: '16px', margin: 0, fontWeight: 600, border: 'none', borderBottom: '1px dashed transparent', background: 'transparent', outline: 'none', color: 'var(--text-primary)', width: '180px', transition: 'border-color 0.2s' }}
                defaultValue={id.name || `Matrix Node ${id.role}`}
                title="Agent Alias (Editable)"
                onFocus={(e) => e.target.style.borderBottomColor = 'var(--text-muted)'}
                onBlur={(e) => {
                  e.target.style.borderBottomColor = 'transparent';
                  handleSwitch('name', e.target.value);
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
              />
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-base)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-subtle)', userSelect: 'all' }} title="Technical Role ID">
                 {id.role}
              </div>
            </div>
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
              
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                {effectiveModelInput === '__custom__' ? (
                  <input
                    autoFocus
                    style={{ border: 'none', borderBottom: '1px dashed var(--accent)', background: 'transparent', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, outline: 'none', width: '120px', padding: '0 2px' }}
                    placeholder="type model name..."
                    disabled={switching}
                    onBlur={e => {
                      const val = e.target.value.trim();
                      if (val) { setModelInput(val); handleSwitch('model', val); }
                      else setModelInput(null);
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setModelInput(null); }}
                  />
                ) : (
                  <select
                    className="agent-card__inline-select"
                    style={{ border: 'none', borderBottom: '1px dashed var(--text-muted)', background: 'transparent', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', outline: 'none', padding: '0 2px', maxWidth: '140px' }}
                    value={effectiveModelInput || 'auto'}
                    disabled={switching}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === '__custom__') { setModelInput('__custom__'); return; }
                      setModelInput(val);
                      handleSwitch('model', val);
                    }}
                  >
                    <option value="auto">auto</option>
                    {/* Current model if not in list */}
                    {effectiveModelInput && effectiveModelInput !== 'auto' && !supportedModels.find(m => m.id === effectiveModelInput) && (
                      <option value={effectiveModelInput}>{effectiveModelInput}</option>
                    )}
                    {supportedModels.map(m => (
                      <option key={m.id} value={m.id}>{m.id}</option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                )}
              </div>
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
              <button className="btn-outline" onClick={(e) => { e.stopPropagation(); onViewLogs(id.role); }}>Logs</button>
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
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-md)' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-sm)', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>Local Runtime Env Overrides</label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              仅作用于这个 agent 的本地 CLI 沙箱；优先级高于全局 CLI Runtime Config，不会覆盖云端任务数据。
            </div>
          </div>
          <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              background: Object.keys(parsedEnv.envVars).length > 0 ? 'rgba(52,211,153,0.12)' : 'var(--bg-base)',
              color: Object.keys(parsedEnv.envVars).length > 0 ? 'var(--status-ok)' : 'var(--text-muted)',
            }}>
              {Object.keys(parsedEnv.envVars).length} keys
            </span>
            {parsedEnv.errors.length > 0 && (
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(248,113,113,0.12)', color: 'var(--status-err)' }}>
                {parsedEnv.errors.length} invalid lines
              </span>
            )}
          </div>
        </div>
        <textarea
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={'CODEX_API_KEY=...\nOPENAI_API_KEY=...\nCUSTOM_FLAG=1'}
          style={{ width: '100%', minHeight: 92, fontFamily: 'monospace', fontSize: 12, padding: 'var(--space-sm)', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', resize: 'vertical' }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-sm)', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {Object.keys(parsedEnv.envVars).length > 0 ? Object.keys(parsedEnv.envVars).join(', ') : 'No per-agent runtime overrides'}
          </div>
          <div className="flex gap-sm">
            <button className="btn-outline" onClick={() => setEnvText(id.envText || '')} disabled={savingEnv}>Reset</button>
            <button className="btn-outline" onClick={handleSaveEnv} disabled={savingEnv} style={savingEnv ? { opacity: 0.6 } : {}}>
              {savingEnv ? 'Saving...' : 'Save Env'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex gap-sm" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-md)' }}>
         {!isRetired ? (
            <>
              <button className="btn-outline" onClick={handleOpenSoul}>Edit SOUL</button>
              <button className="btn-outline" onClick={onBackup}>Backup</button>
              <button 
                className="btn-outline" 
                onClick={handleTestAgent} 
                disabled={isTesting}
                style={isTesting ? { opacity: 0.6 } : {}}
              >
                {isTesting ? 'Testing...' : 'Test Agent'}
              </button>
              <div style={{ flex: 1 }} />
              {isRetiring ? (
                <button className="btn-outline" disabled style={{ opacity: 0.6, cursor: 'not-allowed', color: 'var(--status-warn)', borderColor: 'var(--status-warn)' }}>Retiring... ⏳</button>
              ) : confirmRetire ? (
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
              {isObliterating ? (
                <button className="btn-outline" disabled style={{ opacity: 0.6, cursor: 'not-allowed', color: 'var(--status-err)', borderColor: 'var(--status-err)' }}>Obliterating... ⏳</button>
              ) : confirmRetire ? (
                <button 
                  className="btn-danger" 
                  onClick={() => { setConfirmRetire(false); onObliterate(); }}
                  onMouseLeave={() => setConfirmRetire(false)}
                >
                  Sure? ⚠️
                </button>
              ) : (
                <button className="btn-danger" onClick={() => setConfirmRetire(true)}>Obliterate 💀</button>
              )}
            </>
         )}
      </div>
       
       {testResponse && (
         <div style={{ 
           marginTop: 'var(--space-md)', 
           padding: 'var(--space-sm) var(--space-md)', 
           background: testResponse.success ? 'rgba(52,211,153,0.05)' : 'rgba(248,113,113,0.05)', 
           border: `1px solid ${testResponse.success ? 'var(--status-ok)' : 'var(--status-err)'}`,
           borderRadius: '4px',
           fontSize: '13px',
           color: testResponse.success ? 'var(--text-primary)' : 'var(--status-err)'
         }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
             <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>
               {testResponse.success ? '✓ Agent Response' : '✗ Connection Failed'}
             </span>
             {testResponse.meta && (
               <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{testResponse.meta}</span>
             )}
             <span style={{ cursor: 'pointer', opacity: 0.6 }} onClick={() => setTestResponse(null)}>✕</span>
           </div>
           <div style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{testResponse.text}</div>
         </div>
       )}

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
