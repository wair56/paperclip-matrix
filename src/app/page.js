'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import AgentCard from '@/components/AgentCard';
import LogViewer from '@/components/LogViewer';
import TelemetryGauge from '@/components/TelemetryGauge';

export default function Dashboard() {
  const [identities, setIdentities] = useState([]);
  const [retiredIdentities, setRetiredIdentities] = useState([]);
  const [runningWorkers, setRunningWorkers] = useState(new Set());
  const [liveRuns, setLiveRuns] = useState({});
  const [viewingLogsFor, setViewingLogsFor] = useState(null);
  const [showAddCompany, setShowAddCompany] = useState(false);

  const [loading, setLoading] = useState(false);
  const [sysinfo, setSysinfo] = useState(null);

  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [newCompany, setNewCompany] = useState({ id: '', name: '', apiUrl: 'https://api.cowork.is', boardKey: '' });
  const [editingCompany, setEditingCompany] = useState(null);

  const [nodeSettings, setNodeSettings] = useState({ frp: {}, proxy: {} });
  const [frpStatus, setFrpStatus] = useState({ isRunning: false, pid: null });
  const [isDeployingFrp, setIsDeployingFrp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [role, setRole] = useState('manager');
  const [executor, setExecutor] = useState('claude-local');
  const [newModel, setNewModel] = useState('');
  const [showProvisionForm, setShowProvisionForm] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [suggestedRoles, setSuggestedRoles] = useState([]); // Now an array of { role, soul } Let's rename to suggestedRolesData later if needed, leaving as is.
  const [pendingSoul, setPendingSoul] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [availableTemplates, setAvailableTemplates] = useState([]);
  const [remoteAgents, setRemoteAgents] = useState([]);
  const [adapters, setAdapters] = useState(['claude-local', 'codex-local', 'gemini-local']);
  
  // Modal states
  const [templateSearch, setTemplateSearch] = useState('');
  const [roleSearch, setRoleSearch] = useState('');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [inspectingAgent, setInspectingAgent] = useState(null);
  const [templateSelections, setTemplateSelections] = useState({});

  const fetchIdentities = useCallback(async () => {
    try {
      const res = await fetch('/api/identity');
      const data = await res.json();
      if (data.success) {
        setIdentities(data.identities);
        setRetiredIdentities(data.retiredIdentities || []);
      }
    } catch (err) { console.error('Identity fetch failed:', err); }
  }, []);

  const fetchSysinfo = useCallback(async () => {
    try {
      const res = await fetch('/api/sysinfo');
      const data = await res.json();
      if (data.success) setSysinfo(data.data);
    } catch (err) { console.error('Sysinfo fetch failed:', err); }
  }, []);

  const fetchLiveRuns = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const res = await fetch(`/api/companies/${selectedCompanyId}/live-runs`);
      const payload = await res.json();
      if (payload.success && Array.isArray(payload.data)) {
        const runMap = {};
        payload.data.forEach(run => {
          if (run.agentId) runMap[run.agentId] = run;
        });
        setLiveRuns(runMap);
      }
    } catch (err) { console.error('Live runs fetch failed:', err); }
  }, [selectedCompanyId]);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await fetch('/api/companies');
      const data = await res.json();
      if (data.success && data.companies) {
        setCompanies(data.companies);
        if (data.companies.length > 0 && !selectedCompanyId) {
          setSelectedCompanyId(data.companies[0].id);
        }
      }
    } catch (err) { console.error('Failed to fetch companies', err); }
  }, [selectedCompanyId]);

  const fetchNodeSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/node-settings');
      setNodeSettings(await res.json());
    } catch (e) { console.error('failed settings', e); }
  }, []);

  const fetchFrpStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/frp');
      setFrpStatus(await res.json());
    } catch (e) { console.error('failed frp status', e); }
  }, []);

  useEffect(() => {
    fetchIdentities();
    fetchCompanies();
    fetchNodeSettings();
    fetchFrpStatus();
    
    const fetchAdapters = async () => {
      try {
        const res = await fetch('/api/adapters');
        const data = await res.json();
        if (data.success && data.adapters) {
          setAdapters(data.adapters);
          if (!data.adapters.includes(executor)) {
            setExecutor(data.adapters[0]);
          }
        }
      } catch (err) { console.error('Failed fetching adapters:', err); }
    };
    fetchAdapters();

    const interval = setInterval(() => {
      fetchSysinfo();
      fetchLiveRuns();
      fetchFrpStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchIdentities, fetchCompanies, fetchNodeSettings, fetchFrpStatus, fetchSysinfo, fetchLiveRuns, executor]);

  // Load available templates into the dropdown list exactly once implicitly via handleDiscover
  useEffect(() => {
    if (selectedCompanyId && availableTemplates.length === 0) {
      handleDiscover();
    }
  }, [selectedCompanyId]);


  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleEditSave = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingCompany)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Successfully updated organization!', false);
        setEditingCompany(null);
        fetchCompanies();
      } else {
        showToast('Failed to update: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
  };

  const handleDeleteCompany = async (e, companyId) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: companyId })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Successfully unlinked organization', false);
        if (selectedCompanyId === companyId) setSelectedCompanyId('');
        fetchCompanies();
      } else {
        showToast('Failed to unlink: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const handleSyncCloud = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/identity/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, false);
        fetchIdentities();
      } else {
        showToast('Sync failed: ' + data.error, true);
      }
    } catch(e) {
      showToast('Network error during sync', true);
    }
    setIsSyncing(false);
  };

  const handleAddCompany = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCompany)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Successfully connected organization!', false);
        const linkedCompanyId = data.company?.id || newCompany.id;
        setNewCompany({ id: '', name: '', apiUrl: 'https://api.cowork.is', boardKey: '' });
        await fetchCompanies();

      } else {
        showToast('Failed to add company: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
  };

  const handleAutoJoin = async (e) => {
    e.preventDefault();
    if (!selectedCompanyId) return showToast("Select a company first.", true);
    setLoading(true);
    try {
      const res = await fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, roleName: role, executor, model: newModel, initialSoul: pendingSoul })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Auto-Join Successful! Agent: ' + data.agentId, false);
        handleStartWorker(role);
        fetchIdentities();
      } else {
        showToast('Failed: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
    setLoading(false);
  };

  const handleTakeover = async (remoteAgent) => {
    setLoading(true);
    try {
      const targetRole = remoteAgent.role || remoteAgent.name.toLowerCase().replace(/\s+/g, '_');
      const res = await fetch('/api/identity/takeover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          companyId: selectedCompanyId, 
          agentId: remoteAgent.id,
          roleName: targetRole,
          executor: adapters[0], // fallback executor
          model: newModel 
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Locally Adopted Agent: ${targetRole}`, false);
        fetchIdentities();
      } else {
        showToast('Takeover Failed: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
    setLoading(false);
  };

  const [discoverError, setDiscoverError] = useState('');

  const handleDiscover = async (tid) => {
    const activeTid = tid !== undefined ? tid : selectedTemplateId;
    if (!selectedCompanyId) {
      setDiscoverError("Please select a Company first.");
      return;
    }
    setDiscoverError('');
    setDiscovering(true);
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, templateId: activeTid })
      });
      const data = await res.json();
      if (data.success) {
        setSuggestedRoles(data.neededRoles || []);
        setAvailableTemplates(data.availableTemplates || []);
        if (data.agents) setRemoteAgents(data.agents);
        
        // Modal Flow: do not auto-select or wipe cart state
        if (tid === undefined && !showTemplateModal && data.neededRoles && data.neededRoles.length > 0) {
           // Single provision logic
           const unhired = data.neededRoles.filter(r => !r.hired);
           if (unhired.length > 0) {
             setRole(unhired[0].role);
             setPendingSoul(unhired[0].soul || '');
           }
        }
      } else {
        setDiscoverError(data.error);
      }
    } catch (err) { setDiscoverError(err.message); }
    setDiscovering(false);
  };

  const handleBulkDeploy = async () => {
    if (!selectedCompanyId) return showToast("Select a company first.", true);
    setLoading(true);
    const toDeploy = Object.values(templateSelections);
    let successCount = 0;
    
    for (const r of toDeploy) {
      try {
        const res = await fetch('/api/identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: selectedCompanyId, roleName: r.role, executor: r.engine, model: r.model, initialSoul: r.soul })
        });
        const data = await res.json();
        if (data.success) {
           successCount++;
           handleStartWorker(r.role);
        }
      } catch (err) { console.error('Bulk deploy err', err); }
    }
    
    showToast(`Deployed ${successCount}/${toDeploy.length} network agents!`, false);
    setShowCheckoutModal(false);
    setTemplateSelections({});
    fetchIdentities();
    setLoading(false);
  };

  const handleStartWorker = async (roleName) => {
    try {
      const res = await fetch('/api/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      if (data.success || res.status === 409) {
        // If 409, it means backend knows it's already running. Sync frontend state.
        setRunningWorkers(prev => new Set([...prev, roleName]));
        showToast(data.success ? data.message : `${roleName} is already active.`, false);
      } else {
        showToast('Failed: ' + data.error, true);
      }
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };

  const handleRetire = async (roleName) => {
    try {
      // 1. Ensure the underlying agent process is killed first
      await handleTerminate(roleName);

      // 2. Soft-delete the identity file
      const res = await fetch('/api/identity', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? data.message : 'Failed: ' + data.error, !data.success);
      if (data.success) {
        setRunningWorkers(prev => { const n = new Set(prev); n.delete(roleName); return n; });
        fetchIdentities();
      }
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };

  const handleRestore = async (roleName) => {
    try {
      const res = await fetch('/api/identity/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? data.message : 'Failed: ' + data.error, !data.success);
      if (data.success) fetchIdentities();
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };

  const handleObliterate = async (roleName) => {
    try {
      const res = await fetch('/api/identity/archive', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? `Obliterated ${roleName}` : 'Failed: ' + data.error, !data.success);
      if (data.success) fetchIdentities();
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };

  const handleTerminate = async (roleName) => {
    try {
      const res = await fetch('/api/worker', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      // Always clear running state, whether or not it was active
      setRunningWorkers(prev => { const n = new Set(prev); n.delete(roleName); return n; });
      showToast(data.success ? data.message : `${roleName} stopped`, false);
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };

  const handleBackup = async (roleName) => {
    try {
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? data.message : 'Failed: ' + data.error, !data.success);
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };



  return (
    <div style={{ width: '85%', maxWidth: 1920, margin: '0 auto', padding: 'var(--space-2xl) var(--space-xl)' }}>
      {toast && (
        <div className={`toast ${toast.isError ? 'toast--err' : 'toast--ok'}`}>
          {toast.message}
        </div>
      )}

      {/* ── Header ── */}
      <header className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2xl)' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            Paperclip Workloads
            <span style={{ fontSize: 11, background: 'var(--accent)', color: 'var(--bg-base)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600, letterSpacing: '0.5px', verticalAlign: 'middle', textTransform: 'uppercase' }}>Local Matrix</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 'var(--space-sm)' }}>
            Autonomous Agent Orchestration Node
          </p>
        </div>
        <div className="flex items-center gap-md">
          <button 
            onClick={() => setShowSettings(!showSettings)} 
            className={`btn-outline flex items-center ${showSettings ? 'active' : ''}`} 
            style={{ gap: 'var(--space-sm)', background: showSettings ? 'var(--bg-elevated)' : 'transparent', position: 'relative' }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Gateway Settings
            {frpStatus.isRunning && <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-pill)', background: 'var(--status-ok)', position: 'absolute', top: '-2px', right: '-2px', border: '2px solid var(--bg-surface)' }}></span>}
          </button>
          
          <a
            href="https://github.com/wair56/paperclip-matrix"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline flex items-center"
            style={{ gap: 'var(--space-sm)', textDecoration: 'none' }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            Star on GitHub
          </a>
        </div>
      </header>

      {/* ── Telemetry Bar ── */}
      {sysinfo && (
        <div className="glass-panel flex items-center gap-xl" style={{ padding: 'var(--space-lg) var(--space-xl)', marginBottom: 'var(--space-xl)' }}>
          <TelemetryGauge label="CPU Load" value={sysinfo.cpuLoadPct} color="var(--accent)" />
          <TelemetryGauge label="Memory" value={sysinfo.memUsagePct} color="var(--accent-secondary)" />
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <div>Avail: {sysinfo.freeMemGb} GB / {sysinfo.totalMemGb} GB</div>
            <div>{sysinfo.platform} · uptime {Math.floor(sysinfo.uptimeSec / 3600)}h</div>
          </div>
        </div>
      )}

      {/* ── Node Network Gateway ── */}
      {showSettings && (
        <section className="glass-panel" style={{ padding: 'var(--space-xl)', marginBottom: 'var(--space-xl)', borderLeft: frpStatus.isRunning ? '3px solid var(--status-ok)' : '3px solid var(--border-default)' }}>
          <h2 style={{ fontSize: 16, marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            🌐 Matrix Global Gateway
            {frpStatus.isRunning ? (
               <span style={{ fontSize: 11, background: 'var(--status-ok)', color: 'var(--bg-base)', padding: '2px 8px', borderRadius: 'var(--radius-lg)' }}>🟢 TUNNEL ACTIVE (PID: {frpStatus.pid})</span>
            ) : (
               <span style={{ fontSize: 11, background: 'var(--border-subtle)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: 'var(--radius-lg)' }}>⚫ OFFLINE</span>
            )}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xl)' }}>
            <div>
              <h3 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>FRP Ingress Tunnel (TCP)</h3>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                <input value={nodeSettings.frp?.serverAddr || ''} onChange={e => setNodeSettings({ ...nodeSettings, frp: { ...nodeSettings.frp, serverAddr: e.target.value } })} placeholder="Server IP (203.2.164.185)" style={{ flex: 2 }} />
                <input value={nodeSettings.frp?.serverPort || ''} onChange={e => setNodeSettings({ ...nodeSettings, frp: { ...nodeSettings.frp, serverPort: parseInt(e.target.value) || '' } })} placeholder="Port" style={{ flex: 1 }} type="number" />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                 <input value={nodeSettings.frp?.token || ''} onChange={e => setNodeSettings({ ...nodeSettings, frp: { ...nodeSettings.frp, token: e.target.value } })} placeholder="Auth Token" style={{ flex: 2 }} type="password" />
                 <input value={nodeSettings.frp?.remotePort || ''} onChange={e => setNodeSettings({ ...nodeSettings, frp: { ...nodeSettings.frp, remotePort: parseInt(e.target.value) || '' } })} placeholder="Remote Port (50002)" style={{ flex: 1 }} type="number" />
              </div>
              {frpStatus.isRunning ? (
                <button 
                  onClick={async () => {
                    await fetch('/api/frp', { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
                    fetchFrpStatus();
                  }} 
                  className="btn-danger"
                >
                  Disconnect Tunnel
                </button>
              ) : (
                <button 
                  onClick={async () => {
                    setIsDeployingFrp(true);
                    try {
                      await fetch('/api/node-settings', { method: 'POST', body: JSON.stringify(nodeSettings) });
                      const res = await fetch('/api/frp', { method: 'POST', body: JSON.stringify({ action: 'start' }) });
                      const payload = await res.json();
                      if (!payload.success) {
                        showToast(`Tunnel failed: ${payload.error || 'Unknown network error'}`, true);
                      } else {
                        showToast('Matrix Tunnel Connected!', false);
                      }
                    } catch (err) {
                      showToast('Tunnel Crash: ' + err.message, true);
                    }
                    fetchFrpStatus();
                    setIsDeployingFrp(false);
                  }} 
                  className="btn-primary"
                  disabled={isDeployingFrp}
                >
                  {isDeployingFrp ? 'Deploying & Connecting...' : 'Connect Tunnel'}
                </button>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>Local LLM Pipeline Proxy</h3>
              <input 
                value={nodeSettings.proxy?.httpsProxy || ''} 
                onChange={e => setNodeSettings({ ...nodeSettings, proxy: { ...nodeSettings.proxy, httpsProxy: e.target.value } })} 
                placeholder="HTTPS_PROXY (e.g. http://127.0.0.1:10809)" 
                style={{ marginBottom: 'var(--space-xs)', width: '100%' }} 
              />
              <input 
                value={nodeSettings.proxy?.openaiBaseUrl || ''} 
                onChange={e => setNodeSettings({ ...nodeSettings, proxy: { ...nodeSettings.proxy, openaiBaseUrl: e.target.value } })} 
                placeholder="OPENAI_BASE_URL (Optional)" 
                style={{ marginBottom: 'var(--space-md)', width: '100%' }} 
              />
              <button 
                 onClick={async () => {
                   await fetch('/api/node-settings', { method: 'POST', body: JSON.stringify(nodeSettings) });
                   showToast('Proxy settings saved globally.');
                 }} 
                 className="btn-outline"
              >
                 Save Proxy
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Main Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 'var(--space-xl)' }}>

        {/* ── LEFT: Master Organizations Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', overflow: 'hidden', minWidth: 0 }}>
          <section className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
            <div className="flex items-center justify-between" style={{ minHeight: '36px', marginBottom: companies.length > 0 ? 'var(--space-md)' : 'var(--space-lg)' }}>
              <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18, fontWeight: 600 }}>Organizations</h2>
              {companies.length > 0 && (
                <button
                  className={showAddCompany ? 'btn-danger' : 'btn-outline'}
                  onClick={() => setShowAddCompany(v => !v)}
                  style={{ padding: '2px 10px', fontSize: 12 }}
                  title={showAddCompany ? 'Cancel' : 'Link New Company'}
                >
                  {showAddCompany ? '✕' : '+'}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-sm" style={{ marginBottom: (showAddCompany || companies.length === 0) ? 'var(--space-lg)' : 0 }}>
              {companies.length === 0 ? (
                <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>No organizations linked yet.</div>
              ) : companies.map(c => {
                const isSelected = selectedCompanyId === c.id;
                const isEditing = editingCompany && editingCompany.id === c.id;
                const onDutyCount = identities.filter(id => id.companyId === c.id).length;
                return (
                  <div key={c.id} onClick={() => !isEditing && setSelectedCompanyId(c.id)} style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-lg)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: `1px solid ${isSelected ? 'var(--border-interactive)' : 'var(--border-subtle)'}`, cursor: isEditing ? 'default' : 'pointer', transition: 'border-color 0.2s ease', position: 'relative' }}>
                    {/* Row 1: Company Name (prominent) */}
                    <div className="flex items-center gap-sm" style={{ marginBottom: 'var(--space-sm)' }}>
                      <span className={`status-dot ${onDutyCount > 0 ? 'status-dot--ok' : ''}`} style={{ background: onDutyCount === 0 ? 'var(--border-default)' : '' }}></span>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || c.id}</h3>
                      {c.status === 'archived' && (
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-base)', border: '1px solid var(--status-err)', color: 'var(--status-err)', whiteSpace: 'nowrap' }}>ARCHIVED</span>
                      )}
                    </div>
                    {/* Row 2: Status badges */}
                    <div className="flex items-center gap-sm" style={{ flexWrap: 'wrap' }}>
                        {onDutyCount > 0 && (
                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--accent-secondary-muted)', color: 'var(--accent-secondary)', whiteSpace: 'nowrap' }}>
                            {onDutyCount} Node{onDutyCount !== 1 ? 's' : ''} Online
                          </span>
                        )}
                        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{c.id}</span>
                    </div>
                    {/* Row 3: Actions */}
                    <div className="flex items-center gap-sm" style={{ marginTop: 'var(--space-xs)', opacity: isEditing ? 0 : 1, transition: 'opacity 0.2s', pointerEvents: isEditing ? 'none' : 'auto' }}>
                         <button onClick={(e) => { e.stopPropagation(); setEditingCompany({ id: c.id, name: c.name, apiUrl: c.apiUrl, boardKey: '' }); }} className="btn-outline" style={{ padding: '2px 8px', fontSize: '11px' }} title="Edit Configuration">Edit</button>
                         <button onClick={(e) => handleDeleteCompany(e, c.id)} className="btn-danger" style={{ padding: '2px 8px', fontSize: '11px' }} title="Unlink Organization">Unlink</button>
                    </div>


                    {isEditing && (
                      <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }} onClick={e => e.stopPropagation()}>
                        <label>Edit Integration (Override)</label>
                        <input placeholder="Organization Name" value={editingCompany.name} onChange={e => setEditingCompany({...editingCompany, name: e.target.value})} />
                        <input placeholder="API URL" value={editingCompany.apiUrl} onChange={e => setEditingCompany({...editingCompany, apiUrl: e.target.value})} />
                        <input type="password" placeholder="New Master Board Key (Blank to keep existing)" value={editingCompany.boardKey} onChange={e => setEditingCompany({...editingCompany, boardKey: e.target.value})} />
                        <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-xs)' }}>
                          <button onClick={() => setEditingCompany(null)} className="btn-outline">Cancel</button>
                          <button onClick={handleEditSave} className="btn-primary">Save Changes</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {(showAddCompany || companies.length === 0) && (
              <form onSubmit={handleAddCompany} style={{ borderTop: companies.length > 0 ? '1px solid var(--border-default)' : 'none', paddingTop: companies.length > 0 ? 'var(--space-md)' : 0 }} className="flex flex-col gap-sm">
                <label style={{ color: 'var(--accent)' }}>+ Link New Company</label>
                <input value={newCompany.name} onChange={e => setNewCompany({ ...newCompany, name: e.target.value })} placeholder="Company Name (e.g. My Startup)" />
                <input value={newCompany.apiUrl} onChange={e => setNewCompany({ ...newCompany, apiUrl: e.target.value })} placeholder="https://api.cowork.is" required />
                <input value={newCompany.id} onChange={e => setNewCompany({ ...newCompany, id: e.target.value })} placeholder="Target Company ID (Leave empty to Auto-Discover)" />
                <input type="password" value={newCompany.boardKey} onChange={e => setNewCompany({ ...newCompany, boardKey: e.target.value })} placeholder="Master Board Key" required />
                <button type="submit" className="btn-outline" style={{ marginTop: 'var(--space-xs)' }}>Connect via Token</button>
              </form>
            )}
          </section>
        </div>

        {/* ── RIGHT: Detail Company Hub ── */}
        <div className="flex flex-col gap-xl">
          {!selectedCompanyId ? (
            <div className="glass-panel" style={{ padding: 'var(--space-3xl) 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 15 }}>
              Select an organization from the left panel to manage its agents.
            </div>
          ) : (() => {
            const activeCompany = companies.find(c => c.id === selectedCompanyId) || {};
            const compAgents = identities.filter(id => id.companyId === selectedCompanyId);
            const orphanedAgents = identities.filter(id => !companies.some(c => c.id === id.companyId));
            
            return (
              <>
                {/* ── Unified Roster + Provision Panel ── */}
                <section className="glass-panel flex flex-col gap-xl" style={{ padding: 'var(--space-xl)' }}>
                  <div className="flex items-center justify-between" style={{ minHeight: '36px', marginBottom: 0 }}>
                    <h2 style={{ fontSize: 24, margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                      {activeCompany.name || activeCompany.id} Roster
                      {activeCompany.status === 'archived' && <span style={{ fontSize: 11, background: 'var(--bg-base)', color: 'var(--status-err)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontWeight: 600, border: '1px solid var(--status-err)' }}>ARCHIVED</span>}
                      {compAgents.length > 0 && (
                        <button onClick={handleSyncCloud} disabled={isSyncing} className="btn-outline" style={{ fontSize: 13, padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                          {isSyncing ? '🔄 Syncing...' : '⟳ Sync Remote Cloud'}
                        </button>
                      )}
                    </h2>
                    <div className="flex items-center gap-sm">
                      {compAgents.length > 0 && (
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-secondary)', background: 'var(--accent-secondary-muted)', padding: '4px 12px', borderRadius: 'var(--radius-pill)' }}>
                          {compAgents.length} active node{compAgents.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {compAgents.length > 0 && (
                        <button
                          className={showProvisionForm ? 'btn-danger' : 'btn-outline'}
                          onClick={() => setShowProvisionForm(f => !f)}
                          style={{ padding: '2px 10px', fontSize: 12 }}
                          title={showProvisionForm ? 'Cancel' : 'Add Agent'}
                        >
                          {showProvisionForm ? '✕' : '+'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Provision Form — shown always when 0 agents, toggle when agents exist */}
                  {(showProvisionForm || compAgents.length === 0) && activeCompany.status !== 'archived' && (
                    <form onSubmit={handleAutoJoin} className="flex flex-col gap-md" style={{ marginTop: compAgents.length === 0 ? 'var(--space-md)' : 0, paddingTop: compAgents.length > 0 ? 'var(--space-md)' : 0, borderTop: compAgents.length > 0 ? '1px solid var(--border-default)' : 'none' }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-xs)' }}>
                        <h3 style={{ margin: 0, fontSize: 15, color: 'var(--accent)' }}>Provision Agent for {activeCompany.name}</h3>
                        <div className="flex items-center gap-sm">
                          <button type="button" onClick={() => { handleDiscover(); setShowTemplateModal(true); }} className="btn-outline" style={{ fontSize: 13, padding: '6px 14px', borderColor: 'var(--accent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                            Browse Market Templates
                          </button>
                        </div>
                      </div>
                      
                      <div>
                        <label style={{ marginBottom: 'var(--space-xs)', display: 'block' }}>Role Alias</label>
                        <input value={role} onChange={e => setRole(e.target.value)} required />
                        {discoverError && (
                          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--status-err)' }}>Error: {discoverError}</div>
                        )}
                      </div>
                      <div>
                        <label>Adapter Engine</label>
                        <select value={executor} onChange={e => setExecutor(e.target.value)}>
                          {adapters.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                      <div>
                        <label>LLM Model</label>
                        <select value={newModel} onChange={e => setNewModel(e.target.value)}>
                          <option value="">auto (Default)</option>
                          <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                          <option value="claude-opus-4-20250514">claude-opus-4</option>
                          <option value="gpt-5.4">gpt-5.4</option>
                          <option value="o3">o3</option>
                          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                        </select>
                      </div>
                      <button type="submit" className="btn-outline" disabled={loading} style={{ marginTop: 'var(--space-xs)', borderColor: loading ? 'var(--border-subtle)' : 'var(--accent)', color: 'var(--accent)' }}>
                        {loading ? 'Bootstrapping…' : 'Initiate Deployment'}
                      </button>
                    </form>
                  )}

                  {/* Agent Cards */}
                  <div className="flex flex-col gap-md">
                    {compAgents.length === 0 ? (
                      <div className="glass-panel" style={{ padding: 'var(--space-2xl) 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                        No nodes running for {activeCompany.name}.
                      </div>
                    ) : compAgents.map(id => (
                      <AgentCard
                        key={id.filename}
                        identity={id}
                        isRunning={runningWorkers.has(id.role)}
                        liveRun={liveRuns[id.agentId]}
                        onViewLogs={() => setViewingLogsFor(id.role)}
                        onIgnite={() => handleStartWorker(id.role)}
                        onBackup={() => handleBackup(id.role)}
                        onTerminate={() => handleTerminate(id.role)}
                        onRetire={() => handleRetire(id.role)}
                        onRefresh={fetchIdentities}
                        showToast={showToast}
                        adapters={adapters}
                      />
                    ))}
                  </div>
                  
                  {/* Remote Roster Sync Block */}
                  {remoteAgents && remoteAgents.filter(ra => !compAgents.some(ca => ca.agentId === ra.id)).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
                      <div style={{ paddingBottom: 'var(--space-xs)', borderBottom: '1px solid var(--border-interactive)' }}>
                        <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>🌩️ Remote Roster (Cloud)</h3>
                      </div>
                      {remoteAgents.filter(ra => !compAgents.some(ca => ca.agentId === ra.id)).map(ra => {
                        const isLive = ra.status === 'online' || ra.status === 'live';
                        const isError = ra.status === 'error';
                        const statusColor = isLive ? 'var(--status-ok)' : isError ? 'var(--status-err)' : 'var(--status-warn)';
                        return (
                          <div key={ra.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)', padding: 'var(--space-md) var(--space-lg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flex: 1, minWidth: 0 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-pill)', background: statusColor, flexShrink: 0 }}></span>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontSize: 14, fontWeight: 600 }}>{ra.role ? ra.role.toUpperCase() : ra.name}</span>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ra.id}</div>
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: statusColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>{ra.status || 'offline'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Retired/Archived Agents */}
                  {(() => {
                    const compRetired = retiredIdentities.filter(id => id.companyId === selectedCompanyId);
                    if (compRetired.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
                        <div style={{ paddingBottom: 'var(--space-xs)', borderBottom: '1px solid rgba(255, 60, 60, 0.3)' }}>
                          <h3 style={{ fontSize: 14, color: 'var(--status-err)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>♻️ Senior Talent Pool (Archived)</h3>
                        </div>
                        {compRetired.map(id => (
                          <AgentCard
                            key={id.filename}
                            identity={id}
                            isRunning={runningWorkers.has(id.role)}
                            liveRun={liveRuns[id.agentId]}
                            isRetired={true}
                            onRestore={() => handleRestore(id.role)}
                            onDownloadArchive={() => window.open(`/api/identity/export?role=${id.role}`, '_blank')}
                            onObliterate={() => handleObliterate(id.role)}
                            onRefresh={fetchIdentities}
                            showToast={showToast}
                            adapters={adapters}
                          />
                        ))}
                      </div>
                    );
                  })()}
                  
                  {/* Legacy Orphans */}
                  {orphanedAgents.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
                      <div style={{ paddingBottom: 'var(--space-xs)', borderBottom: '1px solid rgba(255, 60, 60, 0.3)' }}>
                        <h3 style={{ fontSize: 14, color: 'var(--status-err)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>Unassigned / Local Legacy</h3>
                      </div>
                      {orphanedAgents.map(id => (
                        <AgentCard
                          key={id.filename}
                          identity={id}
                          isRunning={runningWorkers.has(id.role)}
                          liveRun={liveRuns[id.agentId]}
                          onViewLogs={() => setViewingLogsFor(id.role)}
                          onIgnite={() => handleStartWorker(id.role)}
                          onBackup={() => handleBackup(id.role)}
                          onTerminate={() => handleTerminate(id.role)}
                          onRefresh={fetchIdentities}
                          showToast={showToast}
                          adapters={adapters}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            );
          })()}
        </div>
      </div>

      {/* Log Viewing Modal */}
      {viewingLogsFor && (
        <div className="log-modal__overlay">
          <div className="log-modal__container">
            <div className="log-modal__header flex justify-between items-center">
              <h3 className="log-modal__title">Logs: {viewingLogsFor}</h3>
              <button className="btn-outline" onClick={() => setViewingLogsFor(null)}>Close</button>
            </div>
            <LogViewer role={viewingLogsFor} />
          </div>
        </div>
      )}

      {/* Template Selection Market Modal */}
      {showTemplateModal && (
        <div className="log-modal__overlay" onClick={() => setShowTemplateModal(false)} style={{ zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" onClick={e => e.stopPropagation()} style={{ width: '85%', maxWidth: '1600px', height: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-interactive)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            
            <div style={{ padding: 'var(--space-lg) var(--space-xl)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                Template Marketplace
              </h2>
              <button className="btn-outline" onClick={() => setShowTemplateModal(false)} style={{ padding: '4px 12px' }}>✕ Close</button>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left Sidebar: Template Catalog */}
              <div style={{ width: '280px', borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <input
                    type="text"
                    placeholder="Search templates..."
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    style={{ width: '100%', padding: '6px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-interactive)', background: 'var(--bg-surface)' }}
                  />
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {availableTemplates.length === 0 && discovering ? (
                    <div style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Catalog...</div>
                  ) : availableTemplates.filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.id.toLowerCase().includes(templateSearch.toLowerCase())).map(t => {
                    const isSel = selectedTemplateId === t.id;
                    return (
                      <div 
                        key={t.id} 
                        onClick={() => { setSelectedTemplateId(t.id); handleDiscover(t.id); setRoleSearch(''); }}
                        style={{ padding: 'var(--space-md) var(--space-lg)', cursor: 'pointer', borderBottom: '1px solid var(--border-default)', borderLeft: `4px solid ${isSel ? 'var(--accent)' : 'transparent'}`, background: isSel ? 'var(--bg-elevated)' : 'transparent' }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14, color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{t.name}</div>
                        {t.cn && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t.cn}</div>}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.id}</span>
                          {t.roleCount !== undefined && <span style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>{t.roleCount} roles</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ padding: 'var(--space-md)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
                  {availableTemplates.filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase()) || t.id.toLowerCase().includes(templateSearch.toLowerCase())).length} templates available
                </div>
              </div>

              {/* Right Panel: Team Composition */}
              <div style={{ flex: 1, padding: 'var(--space-2xl)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {!selectedTemplateId ? (
                  <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.5, marginBottom: 16 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <div>Select a template from the catalog</div>
                  </div>
                ) : (
                  <>
                    <div style={{ marginBottom: 'var(--space-2xl)' }}>
                      <h3 style={{ margin: 0, fontSize: 22, display: 'flex', alignItems: 'center' }}>
                        {availableTemplates.find(t => t.id === selectedTemplateId)?.name}
                        {availableTemplates.find(t => t.id === selectedTemplateId)?.cn && (
                          <span style={{ fontSize: 16, color: 'var(--text-muted)', marginLeft: 12, fontWeight: 400 }}>
                            {availableTemplates.find(t => t.id === selectedTemplateId)?.cn}
                          </span>
                        )}
                      </h3>
                      <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-sm)', fontSize: 14 }}>
                        Review the team composition below. Check the agents you wish to deploy into the active roster. Agents currently online are disabled.
                      </p>
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ marginBottom: 'var(--space-md)' }}>
                        <input
                          type="text"
                          placeholder={`Filter ${suggestedRoles.length} roles...`}
                          value={roleSearch}
                          onChange={(e) => setRoleSearch(e.target.value)}
                          style={{ width: '100%', padding: '8px 12px', fontSize: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-interactive)', background: 'var(--bg-base)' }}
                        />
                      </div>
                      
                      <div style={{ flex: 1, overflowY: 'auto' }}>
                        {discovering ? (
                          <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 'var(--space-xl)' }}>Analyzing Composition...</div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 'var(--space-md)' }}>
                            {suggestedRoles.filter(r => r.role.toLowerCase().includes(roleSearch.toLowerCase()) || (r.soul && r.soul.toLowerCase().includes(roleSearch.toLowerCase()))).map((r, i) => {
                              const isSelected = templateSelections[r.role];
                              return (
                                <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)', padding: 'var(--space-md)', background: r.hired ? 'var(--bg-base)' : (isSelected ? 'var(--bg-elevated)' : 'transparent'), border: `1px solid ${r.hired ? 'var(--border-default)' : (isSelected ? 'var(--border-interactive)' : 'var(--border-subtle)')}`, borderRadius: 'var(--radius-md)', cursor: r.hired ? 'not-allowed' : 'pointer', opacity: r.hired ? 0.6 : 1, transition: 'all 0.2s' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={r.hired ? true : !!isSelected} 
                                    disabled={r.hired}
                                    onChange={(e) => {
                                      if (!r.hired) {
                                        setTemplateSelections(prev => {
                                          const next = { ...prev };
                                          if (e.target.checked) {
                                            next[r.role] = { role: r.role, soul: r.soul, engine: 'claude-local', model: '' };
                                          } else {
                                            delete next[r.role];
                                          }
                                          return next;
                                        });
                                      }
                                    }}
                                    style={{ margin: '4px 0 0 0', width: '16px', height: '16px', flexShrink: 0, outline: 'none', border: 'none', boxShadow: 'none', cursor: 'pointer' }}
                                  />
                                  <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                      <div style={{ wordBreak: 'break-word', lineHeight: 1.2, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{r.role}</div>
                                        {r.cn && r.cn !== r.role.toLowerCase().replace(/-/g, '') && (
                                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.cn}</div>
                                        )}
                                      </div>
                                      <button 
                                        type="button"
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setInspectingAgent(r); }}
                                        className="btn-outline" 
                                        style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-interactive)', borderRadius: '4px', flexShrink: 0 }}
                                      >
                                        Inspect
                                      </button>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                      {r.soul ? r.soul.substring(0, 100) + '...' : 'Base configuration identity.'}
                                    </div>
                                    {r.hired && <div style={{ fontSize: 10, color: 'var(--status-ok)', fontWeight: 600, marginTop: 6, textTransform: 'uppercase' }}>✓ Active Node</div>}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: 'var(--space-2xl)', paddingTop: 'var(--space-xl)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-md)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{Object.keys(templateSelections).length}</strong> agents drafted globally
                        {Object.keys(templateSelections).length > 0 && (
                          <button onClick={() => setTemplateSelections({})} className="btn-outline" style={{ border: 'none', padding: '0 8px', fontSize: 12, marginLeft: 'var(--space-sm)' }}>[Clear All]</button>
                        )}
                      </span>
                      <button 
                        onClick={() => { setShowTemplateModal(false); setShowCheckoutModal(true); }} 
                        disabled={Object.keys(templateSelections).length === 0} 
                        className="btn-primary" 
                        style={{ padding: '8px 24px', fontSize: 14 }}
                      >
                        Review Draft Checkout →
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCheckoutModal && (
        <div className="log-modal__overlay" onClick={() => setShowCheckoutModal(false)} style={{ zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" onClick={e => e.stopPropagation()} style={{ width: '85%', maxWidth: '1600px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-interactive)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--space-lg) var(--space-xl)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                Deployment Checkout ({Object.keys(templateSelections).length} Agents)
              </h2>
              <button className="btn-outline" onClick={() => setShowCheckoutModal(false)} style={{ padding: '4px 12px' }}>✕ Edit Draft</button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-xl)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {Object.values(templateSelections).map((r) => (
                  <div key={r.role} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-md) var(--space-lg)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{r.role}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{r.soul ? r.soul.substring(0, 120) + '...' : 'Base configuration identity'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                      <select 
                        value={r.engine} 
                        onChange={(e) => setTemplateSelections(prev => ({ ...prev, [r.role]: { ...r, engine: e.target.value } }))}
                        style={{ padding: '6px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-interactive)', background: 'var(--bg-base)', outline: 'none', width: 'auto' }}
                      >
                        {adapters.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <select 
                        value={r.model} 
                        onChange={(e) => setTemplateSelections(prev => ({ ...prev, [r.role]: { ...r, model: e.target.value } }))}
                        style={{ padding: '6px 12px', fontSize: 13, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-interactive)', background: 'var(--bg-base)', outline: 'none', width: 'auto' }}
                      >
                        <option value="">auto (Default)</option>
                        <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
                        <option value="claude-opus-4-20250514">claude-opus-4</option>
                        <option value="gpt-5.4">gpt-5.4</option>
                        <option value="o3">o3</option>
                        <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                      </select>
                      <button onClick={() => setTemplateSelections(prev => { const n = {...prev}; delete n[r.role]; return n; })} className="btn-outline" style={{ border: 'none', color: 'var(--text-muted)', padding: '4px 8px' }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: 'var(--space-xl)', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-base)' }}>
              <button 
                onClick={handleBulkDeploy} 
                disabled={loading || Object.keys(templateSelections).length === 0} 
                className="btn-primary" 
                style={{ padding: '10px 28px', fontSize: 15 }}
              >
                {loading ? 'Igniting Engines...' : `Commit & Deploy ${Object.keys(templateSelections).length} Agents`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Agent Soul Modal */}
      {inspectingAgent && (
        <div className="log-modal__overlay" onClick={() => setInspectingAgent(null)} style={{ zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" onClick={e => e.stopPropagation()} style={{ width: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', border: '1px solid var(--border-interactive)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: 'var(--space-lg) var(--space-xl)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                <span style={{ fontSize: 24 }}>🔍</span>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Identity Profile</h2>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{inspectingAgent.role}</div>
                </div>
              </div>
              <button className="btn-outline" onClick={() => setInspectingAgent(null)} style={{ padding: '4px 12px' }}>✕ Close</button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-xl)', background: 'var(--bg-base)' }}>
              <h3 style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 'var(--space-md)', textTransform: 'uppercase', letterSpacing: 1 }}>System Prompt / Soul</h3>
              <pre style={{ 
                whiteSpace: 'pre-wrap', 
                wordWrap: 'break-word', 
                fontFamily: 'monospace', 
                fontSize: 13, 
                lineHeight: 1.6, 
                color: 'var(--text-secondary)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                padding: 'var(--space-lg)',
                borderRadius: 'var(--radius-md)'
              }}>
                {inspectingAgent.soul || 'No soul instructions defined.'}
              </pre>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
