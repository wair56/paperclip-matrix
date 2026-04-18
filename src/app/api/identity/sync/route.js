import { NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { getExecutorNameFromAdapterType } from '@/lib/executors';
import { buildIdentityEnvStorage } from '@/lib/identityEnv';

export async function POST(req) {
  try {
    const db = getDb();
    const companies = db.prepare(`SELECT * FROM companies`).all();
    const activeIdentities = db.prepare(`SELECT role, agentId, companyId FROM identities WHERE status = 'active'`).all();
    
    // Group local identities by companyId
    const localAgentsByCompany = {};
    const agentRoleMap = {};
    
    activeIdentities.forEach(row => {
      const cId = row.companyId;
      const aId = row.agentId;
      if (cId && aId) {
        if (!localAgentsByCompany[cId]) localAgentsByCompany[cId] = [];
        localAgentsByCompany[cId].push(aId);
        agentRoleMap[aId] = row.role;
      }
    });

    let retiredCount = 0;
    let provisionedCount = 0;

    // For each company linked, fetch the truth from the cloud
    for (const company of companies) {
      if (!company || !company.apiUrl || !company.boardKey) continue;

      try {
        const res = await fetch(`${company.apiUrl}/api/companies/${company.id}/agents`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${company.boardKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (res.ok) {
          const payload = await res.json();
          // Handle both { data: [...] } and direct array responses
          const remoteAgents = Array.isArray(payload) ? payload : (payload.data || payload.agents || []);
          const remoteIds = new Set(remoteAgents.map(a => a.id));
          const localSet = new Set(localAgentsByCompany[company.id] || []);
          
          // 1. Check local agents against remote truth (Retire only confirmed-deleted agents)
          const remoteListTrusted = remoteAgents.length > 0 || res.status === 200;
          
          for (const localAgentId of localSet) {
            if (!remoteIds.has(localAgentId) && remoteListTrusted) {
              // Double-check: query the specific agent endpoint to confirm it's truly gone
              try {
                const checkRes = await fetch(`${company.apiUrl}/api/agents/${localAgentId}`, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${company.boardKey}`,
                    'Content-Type': 'application/json'
                  }
                });
                if (checkRes.status === 404 || checkRes.status === 410) {
                  // Confirmed deleted remotely — safe to retire locally
                  const role = agentRoleMap[localAgentId];
                  console.log(`[Matrix-Sync] Agent ${localAgentId} confirmed deleted remotely, retiring local role: ${role}`);
                  db.prepare(`UPDATE identities SET status = 'retired' WHERE role = ?`).run(role);
                  retiredCount++;
                } else {
                  console.log(`[Matrix-Sync] Agent ${localAgentId} not in list but still exists remotely (status ${checkRes.status}), keeping local.`);
                }
              } catch (checkErr) {
                console.warn(`[Matrix-Sync] Could not confirm deletion of ${localAgentId}, keeping local:`, checkErr.message);
              }
            }
          }

          // 2. Check remote agents against local truth (Provision missing agents)
          for (const ra of remoteAgents) {
            const resolvedExecutor = getExecutorNameFromAdapterType(ra.adapterType === 'http' ? null : ra.adapterType, 'claude-local');
            const resolvedModel = ra.adapterConfig?.model || null;
            const localIdentity = db.prepare(`SELECT role, envJson, localEnvJson, cloudEnvJson FROM identities WHERE agentId = ?`).get(ra.id);
            const nextEnvStorage = buildIdentityEnvStorage({
              row: localIdentity || {},
              nextCloudEnv: ra.runtimeConfig && typeof ra.runtimeConfig === 'object' ? ra.runtimeConfig : {},
            });

            if (localIdentity) {
              db.prepare(`
                UPDATE identities
                SET name = COALESCE(?, name),
                    executor = COALESCE(?, executor),
                    model = COALESCE(?, model),
                    cloudEnvJson = ?,
                    localEnvJson = ?,
                    envJson = ?
                WHERE agentId = ?
              `).run(
                ra.name || null,
                ra.adapterType === 'http' ? null : resolvedExecutor,
                resolvedModel,
                nextEnvStorage.cloudEnvJson,
                nextEnvStorage.localEnvJson,
                nextEnvStorage.envJson,
                ra.id
              );
            }

            if (!localSet.has(ra.id)) {
              // Exists natively on Cloud, but completely missing locally! Auto-provision it.
              let safeRole = (ra.role || 'orphan').replace(/[^a-zA-Z0-9_-]/g, '');
              const existingRole = db.prepare(`SELECT role FROM identities WHERE role = ?`).get(safeRole);
              if (existingRole) {
                safeRole = `${safeRole}_${ra.id.substring(0, 5)}`;
              }
              
              db.prepare(`
                INSERT OR REPLACE INTO identities 
                (role, name, agentId, apiUrl, companyId, executor, model, timeoutMs, apiKey, envJson, localEnvJson, cloudEnvJson, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
              `).run(
                safeRole,
                ra.name || null,
                ra.id,
                company.apiUrl,
                company.id,
                resolvedExecutor,
                resolvedModel,
                1800000,
                company.boardKey, // Use boardKey as fallback API key
                nextEnvStorage.envJson,
                nextEnvStorage.localEnvJson,
                nextEnvStorage.cloudEnvJson
              );
              provisionedCount++;
            }
          }
        }
      } catch (err) {
        console.error(`[Matrix-Sync] Failed to sync company ${company.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, retiredCount, provisionedCount, message: `Sync complete. Retired ${retiredCount}, Adopted ${provisionedCount} workers.` });
  } catch (error) {
    console.error(`[Matrix-Sync] General Error:`, error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
