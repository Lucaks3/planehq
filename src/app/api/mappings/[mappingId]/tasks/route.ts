import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";

// GET /api/mappings/[mappingId]/tasks - Get all tasks from both systems
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mappingId: string }> }
) {
  try {
    const { mappingId } = await params;

    // Get the project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json(
        { error: "Project mapping not found" },
        { status: 404 }
      );
    }

    // Fetch tasks from both systems in parallel
    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    const [planeTasks, asanaTasks, taskMappings] = await Promise.all([
      planeClient.listIssues(mapping.planeProjectId).catch(err => {
        console.error("Error fetching Plane tasks:", err);
        return [];
      }),
      asanaClient.listTasks(mapping.asanaProjectGid, mapping.asanaSectionName || undefined).catch(err => {
        console.error("Error fetching Asana tasks:", err);
        return [];
      }),
      prisma.taskMapping.findMany({
        where: { projectMappingId: mappingId },
        select: {
          id: true,
          planeIssueId: true,
          planeIssueName: true,
          asanaTaskGid: true,
          asanaTaskName: true,
          syncStatus: true,
          matchConfidence: true,
        },
      }),
    ]);

    return NextResponse.json({
      mapping,
      planeTasks,
      asanaTasks,
      taskMappings,
    });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}
