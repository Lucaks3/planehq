import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAsanaClient } from "@/lib/asana-client";
import { findMatches } from "@/lib/matching";

// GET /api/tasks/suggestions?taskMappingId=xxx
// Get match suggestions for a Plane task
export async function GET(req: NextRequest) {
  try {
    const taskMappingId = req.nextUrl.searchParams.get("taskMappingId");

    if (!taskMappingId) {
      return NextResponse.json(
        { error: "taskMappingId is required" },
        { status: 400 }
      );
    }

    // Get the task mapping with project info
    const taskMapping = await prisma.taskMapping.findUnique({
      where: { id: taskMappingId },
      include: {
        projectMapping: true,
      },
    });

    if (!taskMapping || !taskMapping.planeIssueName) {
      return NextResponse.json(
        { error: "Task mapping not found" },
        { status: 404 }
      );
    }

    // Fetch Asana tasks for the mapped project
    const asanaClient = getAsanaClient();
    const asanaTasks = await asanaClient.listProjectTasks(
      taskMapping.projectMapping.asanaProjectGid
    );

    // Find matches
    const suggestions = findMatches(
      taskMapping.planeIssueName,
      asanaTasks.map((t) => ({ gid: t.gid, name: t.name }))
    );

    return NextResponse.json({
      planeTaskName: taskMapping.planeIssueName,
      suggestions,
    });
  } catch (error) {
    console.error("Error getting suggestions:", error);
    return NextResponse.json(
      { error: "Failed to get suggestions" },
      { status: 500 }
    );
  }
}
