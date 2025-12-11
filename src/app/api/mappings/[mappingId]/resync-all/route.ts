import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";

// Get month abbreviation from date string (YYYY-MM-DD), or "Q1" if no date set
function getMonthAbbr(dateStr: string | undefined | null): string {
  if (!dateStr) return "Q1";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Q1";
  return months[date.getMonth()];
}

interface RouteParams {
  params: Promise<{ mappingId: string }>;
}

// POST /api/mappings/[mappingId]/resync-all
// Resync all linked tasks (update Asana task names with latest formatting)
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;

    // Get all task mappings for this project that have both Plane and Asana linked
    const taskMappings = await prisma.taskMapping.findMany({
      where: {
        projectMappingId: mappingId,
        planeIssueId: { not: null },
        asanaTaskGid: { not: null },
      },
      include: { projectMapping: true },
    });

    if (taskMappings.length === 0) {
      return NextResponse.json({
        resynced: [],
        errors: [],
        summary: { total: 0, success: 0, failed: 0 },
      });
    }

    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    const resynced: { taskMappingId: string; planeIssueName: string; newAsanaName: string }[] = [];
    const errors: { taskMappingId: string; error: string }[] = [];

    for (const taskMapping of taskMappings) {
      try {
        if (!taskMapping.planeIssueId || !taskMapping.asanaTaskGid) continue;

        // Fetch full Plane issue details (with labels expanded)
        const planeIssue = await planeClient.getIssue(
          taskMapping.projectMapping.planeProjectId,
          taskMapping.planeIssueId
        );

        // Build task name with labels and month: [label1, label2] - Dec - Task Name
        const labelPrefix = planeIssue.labels && planeIssue.labels.length > 0
          ? `[${planeIssue.labels.map(l => l.name).join(", ")}]`
          : null;
        const monthPrefix = getMonthAbbr(planeIssue.target_date);

        // Combine prefixes: [Labels] - Dec - Task Name
        const prefixes = [labelPrefix, monthPrefix].filter(Boolean).join(" - ");
        const asanaTaskName = prefixes ? `${prefixes} - ${planeIssue.name}` : planeIssue.name;

        // Update Asana task name only (not description or comments)
        await asanaClient.updateTask(taskMapping.asanaTaskGid, { name: asanaTaskName });

        // Update the task mapping with new Asana name and sync timestamp
        await prisma.taskMapping.update({
          where: { id: taskMapping.id },
          data: {
            asanaTaskName: asanaTaskName,
            lastSyncedAt: new Date(),
          },
        });

        resynced.push({
          taskMappingId: taskMapping.id,
          planeIssueName: planeIssue.name,
          newAsanaName: asanaTaskName,
        });
      } catch (error) {
        console.error(`Error resyncing task mapping ${taskMapping.id}:`, error);
        errors.push({
          taskMappingId: taskMapping.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      resynced,
      errors,
      summary: {
        total: taskMappings.length,
        success: resynced.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error resyncing all tasks:", error);
    return NextResponse.json(
      { error: "Failed to resync tasks" },
      { status: 500 }
    );
  }
}
