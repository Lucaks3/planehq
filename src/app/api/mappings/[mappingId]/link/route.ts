import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/mappings/[mappingId]/link - Link a Plane task to an Asana task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ mappingId: string }> }
) {
  try {
    const { mappingId } = await params;
    const body = await req.json();
    const { planeTaskId, planeTaskName, asanaTaskGid, asanaTaskName } = body;

    if (!planeTaskId || !asanaTaskGid) {
      return NextResponse.json(
        { error: "Both planeTaskId and asanaTaskGid are required" },
        { status: 400 }
      );
    }

    // Check if mapping exists
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json(
        { error: "Project mapping not found" },
        { status: 404 }
      );
    }

    // Check if either task is already linked
    const existingPlaneLink = await prisma.taskMapping.findUnique({
      where: { planeIssueId: planeTaskId },
    });

    const existingAsanaLink = await prisma.taskMapping.findUnique({
      where: { asanaTaskGid: asanaTaskGid },
    });

    if (existingPlaneLink && existingPlaneLink.asanaTaskGid) {
      return NextResponse.json(
        { error: "Plane task is already linked to another Asana task" },
        { status: 400 }
      );
    }

    if (existingAsanaLink && existingAsanaLink.planeIssueId) {
      return NextResponse.json(
        { error: "Asana task is already linked to another Plane task" },
        { status: 400 }
      );
    }

    // Create or update the task mapping
    let taskMapping;

    if (existingPlaneLink) {
      // Update existing Plane-only mapping
      taskMapping = await prisma.taskMapping.update({
        where: { id: existingPlaneLink.id },
        data: {
          asanaTaskGid,
          asanaTaskName,
          syncStatus: "MATCHED",
          matchMethod: "manual",
          matchConfidence: 1.0,
        },
      });
    } else if (existingAsanaLink) {
      // Update existing Asana-only mapping
      taskMapping = await prisma.taskMapping.update({
        where: { id: existingAsanaLink.id },
        data: {
          planeIssueId: planeTaskId,
          planeIssueName: planeTaskName,
          syncStatus: "MATCHED",
          matchMethod: "manual",
          matchConfidence: 1.0,
        },
      });
    } else {
      // Create new mapping
      taskMapping = await prisma.taskMapping.create({
        data: {
          projectMappingId: mappingId,
          planeIssueId: planeTaskId,
          planeIssueName: planeTaskName,
          asanaTaskGid,
          asanaTaskName,
          syncStatus: "MATCHED",
          matchMethod: "manual",
          matchConfidence: 1.0,
        },
      });
    }

    // Log the link action
    await prisma.syncHistory.create({
      data: {
        taskMappingId: taskMapping.id,
        action: "manual_link",
        details: JSON.stringify({
          planeTaskId,
          planeTaskName,
          asanaTaskGid,
          asanaTaskName,
        }),
      },
    });

    return NextResponse.json(taskMapping, { status: 201 });
  } catch (error) {
    console.error("Error linking tasks:", error);
    return NextResponse.json(
      { error: "Failed to link tasks" },
      { status: 500 }
    );
  }
}
