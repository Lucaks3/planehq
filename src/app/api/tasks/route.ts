import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";
import { findMatches } from "@/lib/matching";

// GET /api/tasks - List task mappings with optional filters
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get("status");
    const projectMappingId = searchParams.get("projectMappingId");

    const where: Record<string, unknown> = {};

    if (status) {
      where.syncStatus = status;
    }
    if (projectMappingId) {
      where.projectMappingId = projectMappingId;
    }

    const tasks = await prisma.taskMapping.findMany({
      where,
      include: {
        projectMapping: {
          select: {
            planeProjectName: true,
            asanaProjectName: true,
          },
        },
        syncHistory: {
          take: 5,
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

// POST /api/tasks/match - Match a Plane task to an Asana task
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskMappingId, asanaTaskGid, asanaTaskName, matchMethod } = body;

    if (!taskMappingId || !asanaTaskGid) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Update the task mapping
    const updated = await prisma.taskMapping.update({
      where: { id: taskMappingId },
      data: {
        asanaTaskGid,
        asanaTaskName,
        matchMethod: matchMethod || "manual",
        matchConfidence: matchMethod === "manual" ? 1.0 : null,
        syncStatus: "MATCHED",
      },
    });

    // Log history
    await prisma.syncHistory.create({
      data: {
        taskMappingId,
        action: "matched",
        details: JSON.stringify({ asanaTaskGid, matchMethod }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error matching task:", error);
    return NextResponse.json(
      { error: "Failed to match task" },
      { status: 500 }
    );
  }
}
