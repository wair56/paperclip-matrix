import { NextResponse } from 'next/server';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { DATA_DIR, WORKSPACES_DIR } from '@/lib/paths';
import { getWorkspacePathForRole } from '@/lib/workspaces';

const ARCHIVES_DIR = path.join(DATA_DIR, 'archives');
if (!existsSync(ARCHIVES_DIR)) mkdirSync(ARCHIVES_DIR, { recursive: true });

export async function POST(req) {
    try {
        const { role } = await req.json();

        if (!role) {
            return NextResponse.json({ success: false, error: "Role is required for backup." }, { status: 400 });
        }

        const sourceDir = getWorkspacePathForRole(role);
        if (!existsSync(sourceDir)) {
            return NextResponse.json({ success: false, error: `Workspace for role ${role} not found.` }, { status: 404 });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const archiveName = `${role}-backup-${timestamp}.tar.gz`;
        const targetPath = path.join(ARCHIVES_DIR, archiveName);

        const cmdArgs = [
            "-czf", targetPath,
            "--exclude=node_modules",
            "--exclude=.git",
            "--exclude=.DS_Store",
            "-C", path.dirname(sourceDir),
            path.basename(sourceDir)
        ];

        const result = spawnSync("tar", cmdArgs, { encoding: "utf8" });

        if (result.status !== 0) {
            throw new Error(result.stderr || "Native Tar export failed.");
        }

        return NextResponse.json({
            success: true,
            message: `Snapshot created successfully at ${targetPath}`,
            path: targetPath
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
    }
}
