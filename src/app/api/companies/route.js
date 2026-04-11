import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const companies = db.prepare(`SELECT id, name, apiUrl, templateType, status FROM companies`).all();
    // Do not transmit the boardKey back to the client!
    const secureList = companies.map(c => ({ 
      id: c.id, 
      name: c.name, 
      apiUrl: c.apiUrl,
      templateType: c.templateType || 'startup',
      status: c.status || 'active'
    }));
    return NextResponse.json({ success: true, companies: secureList });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { apiUrl, boardKey, id: providedId, name: providedName, templateType, proxyUrl, openaiBaseUrl, webhookDomain } = await req.json();
    if (!apiUrl || !boardKey) {
      return NextResponse.json({ success: false, error: 'Missing API URL or Board Key' }, { status: 400 });
    }

    let id = providedId;
    let name = providedName || (providedId ? `Linked Org (${providedId})` : null);
    
    if (!id) {
      // Auto-Discover Company IDs via Official GET /api/companies standard
      try {
        const authRes = await fetch(`${apiUrl}/api/companies`, {
          headers: { "Authorization": `Bearer ${boardKey}` }
        });
        if (!authRes.ok) throw new Error(`Remote API returned HTTP ${authRes.status}`);
        
        const payload = await authRes.json();
        
        // Handle either raw array or nested `{ companies: [] }`
        const companyList = Array.isArray(payload) ? payload : (payload.companies || payload.data || []);
        if (!companyList || companyList.length === 0) {
           throw new Error("No companies returned for this token.");
        }
        
        const db = getDb();
        let linkedCount = 0;
        const linkedCompanies = [];

        // Transactional insertion for all accessible enterprises
        const insertStmt = db.prepare(`
          INSERT OR REPLACE INTO companies (id, name, apiUrl, templateType, boardKey, proxyUrl, openaiBaseUrl, webhookDomain, status) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        db.transaction(() => {
          for (const comp of companyList) {
            const compId = comp.id || comp.companyId;
            const compName = comp.name || comp.companyName || compId;
            const compStatus = comp.status || 'active';
            insertStmt.run(compId, compName, apiUrl, templateType || 'startup', boardKey, proxyUrl || null, openaiBaseUrl || null, webhookDomain || null, compStatus);
            linkedCompanies.push({ id: compId, name: compName, apiUrl, status: compStatus });
            linkedCount++;
          }
        })();

        if (linkedCount === 0) {
          return NextResponse.json({ success: false, error: "Token provided access to organizations, but they are all archived or inaccessible." }, { status: 403 });
        }

        return NextResponse.json({ 
          success: true, 
          message: `Successfully Linked ${linkedCount} Active Enterprise(s)`, 
          companies: linkedCompanies,
          // Legacy support for single-selection dashboards:
          company: linkedCompanies[0] 
        });

      } catch (err) {
        return NextResponse.json({ success: false, error: `Auth or Network Probe Failed: ${err.message}` }, { status: 403 });
      }
    } else {
      // Explicit Single Company Join
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO companies (id, name, apiUrl, templateType, boardKey, proxyUrl, openaiBaseUrl, webhookDomain, status) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, apiUrl, templateType || 'startup', boardKey, proxyUrl || null, openaiBaseUrl || null, webhookDomain || null, 'active');

      return NextResponse.json({ success: true, message: `Successfully Linked ${name}`, company: { id, name, apiUrl, status: 'active' } });
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'Missing company id' }, { status: 400 });

    const db = getDb();
    db.prepare(`DELETE FROM companies WHERE id = ?`).run(id);

    return NextResponse.json({ success: true, message: `Unlinked organization.` });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const { id, name, apiUrl, boardKey, templateType, proxyUrl, openaiBaseUrl, webhookDomain } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: 'Missing company id' }, { status: 400 });

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
    if (!existing) return NextResponse.json({ success: false, error: 'Company not found' }, { status: 404 });

    db.prepare(`
      UPDATE companies 
      SET name = ?, apiUrl = ?, boardKey = ?, templateType = ?, proxyUrl = ?, openaiBaseUrl = ?, webhookDomain = ? 
      WHERE id = ?
    `).run(
      name !== undefined ? name : existing.name,
      apiUrl !== undefined ? apiUrl : existing.apiUrl,
      boardKey !== undefined ? boardKey : existing.boardKey,
      templateType !== undefined ? templateType : existing.templateType,
      proxyUrl !== undefined ? proxyUrl : existing.proxyUrl,
      openaiBaseUrl !== undefined ? openaiBaseUrl : existing.openaiBaseUrl,
      webhookDomain !== undefined ? webhookDomain : existing.webhookDomain,
      id
    );

    return NextResponse.json({ success: true, message: `Successfully updated organization ${id}` });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
