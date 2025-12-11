import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";

// GET /api/projects - List all project mappings and available projects
export async function GET() {
  try {
    // Get existing mappings
    const mappings = await prisma.projectMapping.findMany({
      include: {
        _count: {
          select: { taskMappings: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Try to fetch available projects from both APIs
    let planeProjects: { id: string; name: string }[] = [];
    let asanaProjects: { gid: string; name: string }[] = [];

    try {
      const planeClient = getPlaneClient();
      planeProjects = await planeClient.listProjects();
    } catch (e) {
      console.warn("Could not fetch Plane projects:", e);
    }

    try {
      const asanaClient = getAsanaClient();
      const workspaces = await asanaClient.listWorkspaces();
      // Filter to only euronext.com workspace
      const euronextWorkspace = workspaces.find(w => w.name.toLowerCase() === "euronext.com");
      if (euronextWorkspace) {
        asanaProjects = await asanaClient.listProjects(euronextWorkspace.gid);
      } else if (workspaces.length > 0) {
        // Fallback to first workspace if Euronext.com not found
        console.warn("Euronext.com workspace not found, available:", workspaces.map(w => w.name));
        asanaProjects = await asanaClient.listProjects(workspaces[0].gid);
      }
    } catch (e) {
      console.warn("Could not fetch Asana projects:", e);
    }

    return NextResponse.json({
      mappings,
      planeProjects,
      asanaProjects,
    });
  } catch (error) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

// POST /api/projects - Create a new project mapping
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      planeProjectId,
      planeProjectName,
      asanaProjectGid,
      asanaProjectName,
      asanaSectionName,
      triggerStateName,
    } = body;

    if (!planeProjectId || !asanaProjectGid || !triggerStateName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const mapping = await prisma.projectMapping.create({
      data: {
        planeProjectId,
        planeProjectName: planeProjectName || planeProjectId,
        asanaProjectGid,
        asanaProjectName: asanaProjectName || asanaProjectGid,
        asanaSectionName: asanaSectionName || null,
        triggerStateName,
      },
    });

    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    console.error("Error creating project mapping:", error);
    return NextResponse.json(
      { error: "Failed to create project mapping" },
      { status: 500 }
    );
  }
}
