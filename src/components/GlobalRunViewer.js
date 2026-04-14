'use client';
import { useState, useEffect } from 'react';

function formatDate(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  return d.toLocaleString();
}

function RunCard({ run, companyName, agentName }) {
  const [expanded, setExpanded] = useState(false);
  const duration = run.repliedAt && run.receivedAt ? ((run.repliedAt - run.receivedAt) / 1000).toFixed(1) + 's' : '...';

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)', marginBottom: 'var(--space-md)' }}>
      {/* Header Info */}
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-sm)' }}>
        <div className="flex items-center gap-md" style={{ flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            [ID: {run.runId ? run.runId.substring(0,8) : 'N/A'}]
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            🏢 {companyName || run.companyId?.substring(0,8) || 'Unknown'}
          </span>
          <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-primary)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--border-interactive)' }}>
            🤖 {agentName || run.role}
          </span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            ↓ {formatDate(run.receivedAt)}
            {run.repliedAt ? `  |  ↑ ${formatDate(run.repliedAt)} (${duration})` : '  |  (Running...)'}
          </span>
        </div>
        <div className="flex gap-sm items-center">
          <span style={{
            fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-pill)',
            background: run.status === 'completed' ? 'var(--status-ok)' : run.status === 'error' ? 'var(--status-err)' : 'var(--status-warn)',
            color: 'var(--bg-base)'
          }}>
            {run.status.toUpperCase()}
          </span>
          <button className="btn-outline" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Expand Details'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginTop: 'var(--space-md)', borderTop: '1px dashed var(--border-subtle)', paddingTop: 'var(--space-md)' }}>
           {/* Incoming Content */}
           <div style={{ display: 'flex', flexDirection: 'column' }}>
             <label>Incoming Content (Task)</label>
             <div style={{ 
               flex: 1,
               background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm)',
               fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)',
               maxHeight: '600px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
             }}>
               {run.prompt || 'No Prompt Recorded'}
             </div>
           </div>

           {/* Outgoing Content */}
           <div style={{ display: 'flex', flexDirection: 'column' }}>
             <label>Outgoing Content (Reply)</label>
             <div style={{ 
               flex: 1,
               background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-sm)',
               fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-primary)',
               maxHeight: '600px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
             }}>
               {run.response || (run.status === 'running' ? 'Waiting for response...' : 'No Response')}
             </div>
           </div>
        </div>
      )}
    </div>
  );
}

export default function GlobalRunViewer() {
  const [companies, setCompanies] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [runs, setRuns] = useState([]);
  
  const [filterCompanyId, setFilterCompanyId] = useState('');
  const [filterAgentId, setFilterAgentId] = useState('');

  // Fetch reference data once
  useEffect(() => {
    fetch('/api/companies').then(res => res.json()).then(data => {
      if(data.success) setCompanies(data.companies || []);
    });
    fetch('/api/identity').then(res => res.json()).then(data => {
      if(data.success) setIdentities(data.identities || []);
    });
  }, []);

  // Poll runs
  useEffect(() => {
    const fetchRuns = async () => {
      let url = '/api/runs?';
      if (filterCompanyId) url += `companyId=${filterCompanyId}&`;
      if (filterAgentId) url += `agentId=${filterAgentId}&`;

      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) {
          setRuns(data.runs || []);
        }
      } catch(e) {}
    };

    fetchRuns();
    const intv = setInterval(fetchRuns, 3000);
    return () => clearInterval(intv);
  }, [filterCompanyId, filterAgentId]);

  return (
    <div style={{ padding: 'var(--space-xl)' }}>
      <div className="flex items-center justify-between gap-xl" style={{ marginBottom: 'var(--space-xl)' }}>
        <h2 style={{ margin: 0, whiteSpace: 'nowrap' }}>Global Task History</h2>
        
        <div className="flex items-center gap-md" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <div className="flex items-center gap-sm">
            <label style={{ margin: 0, whiteSpace: 'nowrap' }}>Company:</label>
            <select style={{ minWidth: '180px', margin: 0 }} value={filterCompanyId} onChange={e => { setFilterCompanyId(e.target.value); setFilterAgentId(''); }}>
              <option value="">All</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id.substring(0,6)})</option>)}
            </select>
          </div>
          <div className="flex items-center gap-sm">
            <label style={{ margin: 0, whiteSpace: 'nowrap' }}>Agent:</label>
            <select style={{ minWidth: '180px', margin: 0 }} value={filterAgentId} onChange={e => setFilterAgentId(e.target.value)}>
              <option value="">All</option>
              {identities.filter(i => !filterCompanyId || i.companyId === filterCompanyId).map(i => (
                <option key={i.agentId} value={i.agentId}>{i.name || i.role} ({i.agentId ? i.agentId.substring(0,8) : '?'})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {runs.length === 0 ? (
          <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
            No task runs recorded matching your filters.
          </div>
        ) : (
          runs.map(r => {
            const comp = companies.find(c => c.id === r.companyId);
            const ag = identities.find(i => i.agentId === r.agentId || i.role === r.role);
            return <RunCard key={r.id} run={r} companyName={comp?.name} agentName={ag?.name || r.role} />
          })
        )}
      </div>
    </div>
  );
}
