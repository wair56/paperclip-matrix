'use client';
import { useState, useEffect, useCallback } from 'react';

export default function Dashboard() {
  const [identities, setIdentities] = useState([]);
  const [retiredIdentities, setRetiredIdentities] = useState([]);
  const [matrixStatus, setMatrixStatus] = useState('OFFLINE');
  const [loading, setLoading] = useState(false);
  const [sysinfo, setSysinfo] = useState(null);

  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [newCompany, setNewCompany] = useState({ id: '', name: '', apiUrl: 'https://api.cowork.is', boardKey: '' });

  const [role, setRole] = useState('agent_01');
  const [executor, setExecutor] = useState('claude-local');
  const [adapters, setAdapters] = useState(['claude-local', 'codex-local', 'gemini-local']);
  
  const [suggestedRoles, setSuggestedRoles] = useState([]);
  const [discovering, setDiscovering] = useState(false);

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
    } catch (err) { console.error('Companies fetch failed:', err); }
  }, [selectedCompanyId]);

  useEffect(() => {
    fetchIdentities();
    fetchSysinfo();
    fetchCompanies();
    
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

    const interval = setInterval(fetchSysinfo, 3000);
    return () => clearInterval(interval);
  }, [fetchIdentities, fetchSysinfo, fetchCompanies]);

  const [toast, setToast] = useState(null);
  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

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
        setNewCompany({ id: '', name: '', apiUrl: 'https://api.cowork.is', boardKey: '' });
        fetchCompanies();
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
        body: JSON.stringify({ companyId: selectedCompanyId, roleName: role, executor })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Auto-Join Successful! Agent: ' + data.agentId, false);
        fetchIdentities();
      } else {
        showToast('Failed: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
    setLoading(false);
  };

  const [discoverError, setDiscoverError] = useState('');

  const handleDiscover = async () => {
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
        body: JSON.stringify({ companyId: selectedCompanyId })
      });
      const data = await res.json();
      if (data.success) {
        setSuggestedRoles(data.neededRoles);
        if (data.neededRoles.length > 0) setRole(data.neededRoles[0]);
      } else {
        setDiscoverError(data.error);
      }
    } catch (err) { setDiscoverError(err.message); }
    setDiscovering(false);
  };

  const handleStartWorker = async (roleName) => {
    try {
      const res = await fetch('/api/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? data.message : 'Failed: ' + data.error, !data.success);
    } catch (err) { showToast('Exception: ' + err.message, true); }
  };

  const handleRetire = async (roleName) => {
    try {
      const res = await fetch('/api/identity', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? data.message : 'Failed: ' + data.error, !data.success);
      if (data.success) fetchIdentities();
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

  const handleTerminate = async (roleName) => {
    try {
      const res = await fetch('/api/worker', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: roleName })
      });
      const data = await res.json();
      showToast(data.success ? data.message : 'Failed: ' + data.error, !data.success);
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

  const isOnline = matrixStatus === 'ONLINE';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--space-2xl) var(--space-xl)' }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 30, right: 30, zIndex: 9999,
          background: toast.isError ? 'var(--status-err)' : 'var(--status-ok)',
          color: '#fff', padding: '12px 20px', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)', fontSize: 13, fontWeight: 500,
          backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)'
        }}>
          {toast.message}
        </div>
      )}

      {/* ── Header ── */}
      <header className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2xl)' }}>
        <div>
          <h1>Matrix Control Plane</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 'var(--space-xs)' }}>
            Autonomous Agent Orchestration Dashboard
          </p>
        </div>
        <div className="flex items-center gap-md">
          <span className={`status-dot ${isOnline ? 'status-dot--ok' : 'status-dot--err'}`}></span>
          <span style={{ fontSize: 13, fontWeight: 500, color: isOnline ? 'var(--status-ok)' : 'var(--text-muted)' }}>
            {matrixStatus}
          </span>
          <button
            className="btn-primary"
            onClick={() => setMatrixStatus(isOnline ? 'OFFLINE' : 'ONLINE')}
          >
            {isOnline ? 'Kill Matrix' : 'Ignite Matrix'}
          </button>
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

      {/* ── Main Grid ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 'var(--space-xl)' }}>

        {/* ── LEFT: Master Organizations Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          <section className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
            <h2 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-lg)', fontSize: 16 }}>Organizations</h2>
            <div className="flex flex-col gap-sm" style={{ marginBottom: 'var(--space-lg)' }}>
              {companies.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No organizations linked yet.</div>
              ) : companies.map(c => {
                const isSelected = selectedCompanyId === c.id;
                const onDutyCount = identities.filter(id => id.companyId === c.id).length;
                return (
                  <div key={c.id} onClick={() => setSelectedCompanyId(c.id)} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: isSelected ? 'rgba(255,255,255,0.08)' : 'var(--bg-base)', borderRadius: 8, border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}`, cursor: 'pointer', transition: 'all 0.2s', boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.1)' : 'none' }}>
                    <div>
                      <div className="flex items-center gap-xs">
                        <span className="status-dot status-dot--ok"></span>
                        <div style={{ fontSize: 14, fontWeight: 600, color: isSelected ? 'var(--accent)' : 'var(--text-primary)' }}>{c.name}</div>
                      </div>
                      <div style={{ fontSize: 11, color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 8 }}>
                         <span>ID: {c.id}</span>
                         <span style={{ color: 'var(--status-ok)' }}>• {onDutyCount} On-Duty</span>
                      </div>
                      {isSelected && suggestedRoles.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 6 }}>
                          Needs: {suggestedRoles.slice(0, 2).join(', ')}{suggestedRoles.length > 2 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <form onSubmit={handleAddCompany} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-md)' }} className="flex flex-col gap-sm">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>+ Link New Company</div>
              <input value={newCompany.apiUrl} onChange={e => setNewCompany({ ...newCompany, apiUrl: e.target.value })} placeholder="https://api.cowork.is" required style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-interactive)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-primary)', outline: 'none', fontSize: 14 }} />
              <input type="password" value={newCompany.boardKey} onChange={e => setNewCompany({ ...newCompany, boardKey: e.target.value })} placeholder="Master Board Key" required style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-interactive)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-primary)', outline: 'none', fontSize: 14 }} />
              <button type="submit" className="btn-outline" style={{ marginTop: 'var(--space-xs)', fontSize: 13, padding: '10px', fontWeight: 600 }}>Connect via Token</button>
            </form>
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
                {/* Hire Form Header */}
                <section className="glass-panel" style={{ padding: 'var(--space-xl)' }}>
                  <h2 style={{ color: 'var(--accent)', marginBottom: 'var(--space-lg)' }}>Provision Agent for {activeCompany.name}</h2>
                  <form onSubmit={handleAutoJoin} className="flex flex-col gap-md">
                    <div>
                      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-xs)' }}>
                        <label style={{ margin: 0 }}>Role Alias</label>
                        <button type="button" onClick={handleDiscover} disabled={discovering} style={{ fontSize: 11, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
                          {discovering ? 'Probing...' : 'Probe Needs'}
                        </button>
                      </div>
                      <input value={role} onChange={e => setRole(e.target.value)} required style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-interactive)', background: 'rgba(255,255,255,0.03)', color: 'var(--text-primary)', outline: 'none', fontSize: 14 }} />
                      {suggestedRoles.length > 0 && (
                        <div className="flex" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                          {suggestedRoles.map(r => (
                            <button key={r} type="button" onClick={() => setRole(r)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: role === r ? 'var(--accent)' : 'var(--bg-base)', color: role === r ? 'var(--bg-base)' : 'var(--text-muted)', border: '1px solid var(--border-interactive)', cursor: 'pointer' }}>
                              {r}
                            </button>
                          ))}
                        </div>
                      )}
                      {discoverError && (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--status-err)' }}>Error: {discoverError}</div>
                      )}
                    </div>
                    <div>
                      <label>Adapter Engine</label>
                      <select value={executor} onChange={e => setExecutor(e.target.value)} style={{ width: '100%', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-interactive)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                        {adapters.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <button type="submit" className="btn-outline" disabled={loading} style={{ marginTop: 'var(--space-sm)', borderColor: loading ? 'var(--border-subtle)' : 'var(--accent)', color: 'var(--accent)' }}>
                      {loading ? 'Bootstrapping…' : 'Initiate Deployment'}
                    </button>
                  </form>
                </section>

                {/* Company Roster */}
                <section className="glass-panel flex flex-col gap-xl" style={{ padding: 'var(--space-xl)', background: 'transparent', border: 'none', boxShadow: 'none' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 0 }}>
                    <h2 style={{ fontSize: 24, margin: 0 }}>{activeCompany.name} Roster</h2>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-secondary)', background: 'var(--accent-secondary-muted)', padding: '4px 12px', borderRadius: 'var(--radius-pill)' }}>
                      {compAgents.length} active node{compAgents.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="flex flex-col gap-md">
                    {compAgents.length === 0 ? (
                      <div className="glass-panel" style={{ padding: 'var(--space-2xl) 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                        No nodes running for {activeCompany.name}.
                      </div>
                    ) : compAgents.map(id => (
                      <AgentCard
                        key={id.filename}
                        identity={id}
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
                  
                  {/* Retired Hub for this Company */}
                  {(() => {
                    const compRetired = retiredIdentities.filter(id => id.companyId === selectedCompanyId);
                    if (compRetired.length === 0) return null;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
                        <div style={{ paddingBottom: 'var(--space-xs)', borderBottom: '1px solid rgba(255, 60, 60, 0.3)' }}>
                          <h3 style={{ fontSize: 14, color: 'var(--status-err)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>♻️ Recycling Bin (Archived)</h3>
                        </div>
                        {compRetired.map(id => (
                          <AgentCard
                            key={id.filename}
                            identity={id}
                            isRetired={true}
                            onRestore={() => handleRestore(id.role)}
                            onRefresh={fetchIdentities}
                            showToast={showToast}
                            adapters={adapters}
                          />
                        ))}
                      </div>
                    );
                  })()}
                  
                  {/* Legacy Orphans - always show them at the bottom just in case */}
                  {orphanedAgents.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginTop: 'var(--space-xl)' }}>
                      <div style={{ paddingBottom: 'var(--space-xs)', borderBottom: '1px solid rgba(255, 60, 60, 0.3)' }}>
                        <h3 style={{ fontSize: 14, color: 'var(--status-err)', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>Unassigned / Local Legacy</h3>
                      </div>
                      {orphanedAgents.map(id => (
                        <AgentCard
                          key={id.filename}
                          identity={id}
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
    </div>
  );
}

/* ── Telemetry Gauge Sub-component ── */
function TelemetryGauge({ label, value, color }) {
  const pct = parseFloat(value) || 0;
  return (
    <div style={{ minWidth: 130 }}>
      <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }}></div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4, letterSpacing: '-0.5px' }}>
        {value}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>%</span>
      </div>
    </div>
  );
}

/* ── Rich Agent Card Sub-component ── */
function AgentCard({ identity: id, onIgnite, onBackup, onTerminate, onRefresh, showToast, adapters = [], isRetired, onRetire, onRestore }) {
  const [expanded, setExpanded] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [health, setHealth] = useState(null);

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
      } else {
        showToast('Switch failed: ' + data.error, true);
      }
    } catch (err) { showToast('Error: ' + err.message, true); }
    setSwitching(false);
  };

  const timeoutMin = Math.round((id.timeoutMs || 1800000) / 60000);

  const metaStyle = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 };
  const valStyle = { color: 'var(--text-secondary)', fontWeight: 500 };
  const selectStyle = {
    width: 'auto', display: 'inline', fontSize: 12, padding: '2px 6px',
    background: 'var(--bg-base)', border: '1px solid var(--border-interactive)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    cursor: 'pointer', verticalAlign: 'middle',
  };

  const StatusDot = ({ ok }) => (
    <span className={`status-dot ${ok ? 'status-dot--ok' : 'status-dot--err'}`} style={{ width: 6, height: 6 }}></span>
  );

  return (
    <div className="agent-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-md)' }}>
      {/* Row 1: Header */}
      <div className="flex items-center justify-between" style={{ cursor: 'pointer', padding: '4px 0' }} onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-md">
          <svg style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', width: 20, height: 20, color: 'var(--text-muted)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          <div>
            <h3 style={{ fontSize: 18, marginTop: 0, marginBottom: 0 }}>{id.role.toUpperCase()}</h3>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
              {id.agentId || '—'}
            </div>
          </div>
        </div>
        <div className="flex gap-sm" onClick={e => e.stopPropagation()}>
          {!isRetired ? (
            <>
              <button className="btn-primary" onClick={onIgnite} style={{ fontSize: 12, padding: '6px 14px' }}>Ignite</button>
              <button className="btn-outline" onClick={onTerminate} style={{ fontSize: 12, padding: '6px 14px' }}>Stop</button>
              <button className="btn-outline" onClick={onBackup} style={{ fontSize: 12, padding: '6px 14px' }}>Backup</button>
              <button className="btn-outline" onClick={onRetire} style={{ fontSize: 12, padding: '6px 14px', color: 'var(--status-err)', borderColor: 'rgba(255, 60, 60, 0.3)' }}>Retire ♻️</button>
            </>
          ) : (
            <button className="btn-primary" onClick={onRestore} style={{ fontSize: 12, padding: '6px 14px' }}>Restore to Active</button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>

      {/* Row 2: Config grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-md)', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-md)' }}>

        <div style={metaStyle}>
          <div>API Server</div>
          <div style={{ ...valStyle, color: 'var(--status-ok)', fontSize: 13 }}>{id.apiUrl || 'local'}</div>
        </div>

        <div style={metaStyle}>
          <div>Company</div>
          <div style={{ ...valStyle, fontSize: 11, fontFamily: 'monospace' }}>{id.companyId ? id.companyId.substring(0, 12) + '…' : '—'}</div>
        </div>

        <div style={metaStyle}>
          <div>Timeout</div>
          <div style={valStyle}>{timeoutMin} min</div>
        </div>

        <div style={metaStyle}>
          <div>Adapter</div>
          <select style={selectStyle} value={id.executor || adapters[0]} disabled={switching} onChange={e => handleSwitch('executor', e.target.value)}>
            {adapters.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div style={metaStyle}>
          <div>Model</div>
          <select style={selectStyle} value={id.model || ''} disabled={switching} onChange={e => handleSwitch('model', e.target.value)}>
            <option value="">auto</option>
            <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
            <option value="claude-opus-4-20250514">claude-opus-4</option>
            <option value="gpt-5.4">gpt-5.4</option>
            <option value="o3">o3</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
          </select>
        </div>

        <div style={metaStyle}>
          <div>Status</div>
          <div className="flex items-center gap-sm">
            <StatusDot ok={true} />
            <span style={{ ...valStyle, fontSize: 12 }}>Ready</span>
          </div>
        </div>
      </div>

      {/* Row 3: Health Checks */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-md)',
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: 'var(--space-md)',
      }}>
        <div style={metaStyle}>
          <div style={{ marginBottom: 4 }}>Local Connection</div>
          {health ? (
            <div className="flex flex-col" style={{ gap: 2 }}>
              <div className="flex items-center gap-sm">
                <StatusDot ok={health.local.identity} />
                <span style={{ fontSize: 12, color: health.local.identity ? 'var(--text-secondary)' : 'var(--status-err)' }}>
                  Identity File {health.local.identity ? '✓' : '✗ Missing'}
                </span>
              </div>
              <div className="flex items-center gap-sm">
                <StatusDot ok={health.local.workspace} />
                <span style={{ fontSize: 12, color: health.local.workspace ? 'var(--text-secondary)' : 'var(--status-warn)' }}>
                  Sandbox Dir {health.local.workspace ? '✓' : '✗ Uncreated'}
                </span>
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking...</span>
          )}
        </div>
        <div style={metaStyle}>
          <div style={{ marginBottom: 4 }}>Remote Connection</div>
          {health ? (
            <div className="flex flex-col" style={{ gap: 2 }}>
              <div className="flex items-center gap-sm">
                <StatusDot ok={health.remote.reachable} />
                <span style={{ fontSize: 12, color: health.remote.reachable ? 'var(--status-ok)' : 'var(--status-err)' }}>
                  {health.remote.reachable ? 'Connected' : 'Unreachable'}
                </span>
              </div>
              {health.remote.latencyMs !== null && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Latency: {health.remote.latencyMs}ms
                  {health.remote.error ? ` — ${health.remote.error}` : ''}
                </span>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Checking...</span>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
