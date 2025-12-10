import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";

// POST /api/sync - Execute sync for a task mapping
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskMappingId, direction } = body;

    if (!taskMappingId) {
      return NextResponse.json(
        { error: "taskMappingId is required" },
        { status: 400 }
      );
    }

    const taskMapping = await prisma.taskMapping.findUnique({
      where: { id: taskMappingId },
      include: { projectMapping: true },
    });

    if (!taskMapping) {
      return NextResponse.json(
        { error: "Task mapping not found" },
        { status: 404 }
      );
    }

    // Determine sync direction
    const syncDirection = direction ||
      (taskMapping.syncStatus === "PENDING_ASANA_SYNC" ? "plane_to_asana" : "asana_to_plane");

    if (syncDirection === "plane_to_asana") {
      await syncPlaneToAsana(taskMapping);
    } else {
      await syncAsanaToPlane(taskMapping);
    }

    // Update status
    const updated = await prisma.taskMapping.update({
      where: { id: taskMappingId },
      data: {
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });

    // Log history
    await prisma.syncHistory.create({
      data: {
        taskMappingId,
        action: syncDirection === "plane_to_asana" ? "synced_to_asana" : "synced_to_plane",
        direction: syncDirection,
        details: JSON.stringify({ timestamp: new Date().toISOString() }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error syncing task:", error);

    // Update task with error status
    if (typeof error === "object" && error !== null) {
      const body = await (error as Response).json?.().catch(() => ({}));
      const taskMappingId = body?.taskMappingId;
      if (taskMappingId) {
        await prisma.taskMapping.update({
          where: { id: taskMappingId },
          data: {
            syncStatus: "ERROR",
            lastSyncError: String(error),
          },
        });
      }
    }

    return NextResponse.json(
      { error: "Failed to sync task" },
      { status: 500 }
    );
  }
}

async function syncPlaneToAsana(taskMapping: {
  id: string;
  planeIssueId: string | null;
  asanaTaskGid: string | null;
  projectMapping: {
    planeProjectId: string;
    asanaProjectGid: string;
  };
}) {
  if (!taskMapping.planeIssueId || !taskMapping.asanaTaskGid) {
    throw new Error("Task must be matched before syncing");
  }

  const planeClient = getPlaneClient();
  const asanaClient = getAsanaClient();

  // Fetch full Plane issue details
  const planeIssue = await planeClient.getIssue(
    taskMapping.projectMapping.planeProjectId,
    taskMapping.planeIssueId
  );

  // Update Asana task with Plane data
  await asanaClient.updateTask(taskMapping.asanaTaskGid, {
    name: planeIssue.name,
    notes: planeIssue.description_html
      ? stripHtml(planeIssue.description_html)
      : undefined,
  });

  // Sync comments from Plane to Asana
  await syncCommentsPlaneToAsana(taskMapping, planeClient, asanaClient);
}

async function syncAsanaToPlane(taskMapping: {
  id: string;
  planeIssueId: string | null;
  asanaTaskGid: string | null;
  projectMapping: {
    planeProjectId: string;
    asanaProjectGid: string;
  };
}) {
  if (!taskMapping.asanaTaskGid || !taskMapping.planeIssueId) {
    throw new Error("Task must be matched before syncing");
  }

  const planeClient = getPlaneClient();
  const asanaClient = getAsanaClient();

  // Fetch full Asana task details
  const asanaTask = await asanaClient.getTask(taskMapping.asanaTaskGid);

  // Update Plane issue with Asana data
  await planeClient.updateIssue(
    taskMapping.projectMapping.planeProjectId,
    taskMapping.planeIssueId,
    {
      name: asanaTask.name,
      description_html: asanaTask.notes
        ? `<p>${asanaTask.notes}</p>`
        : undefined,
    }
  );

  // Sync comments from Asana to Plane
  await syncCommentsAsanaToPlane(taskMapping, planeClient, asanaClient);
}

async function syncCommentsPlaneToAsana(
  taskMapping: { id: string; planeIssueId: string | null; asanaTaskGid: string | null; projectMapping: { planeProjectId: string } },
  planeClient: ReturnType<typeof getPlaneClient>,
  asanaClient: ReturnType<typeof getAsanaClient>
) {
  if (!taskMapping.planeIssueId || !taskMapping.asanaTaskGid) return;

  // Get comments from Plane
  const planeComments = await planeClient.listComments(
    taskMapping.projectMapping.planeProjectId,
    taskMapping.planeIssueId
  );

  for (const comment of planeComments) {
    // Check if already synced
    const existingSync = await prisma.commentSync.findFirst({
      where: {
        sourceSystem: "plane",
        sourceCommentId: comment.id,
      },
    });

    if (existingSync) continue;

    // Create comment in Asana
    const commentText = stripHtml(comment.comment_html);
    const asanaComment = await asanaClient.createComment(
      taskMapping.asanaTaskGid,
      `[From Plane] ${commentText}`
    );

    // Record the sync
    await prisma.commentSync.create({
      data: {
        taskMappingId: taskMapping.id,
        sourceSystem: "plane",
        sourceCommentId: comment.id,
        targetCommentId: asanaComment.gid,
      },
    });
  }
}

async function syncCommentsAsanaToPlane(
  taskMapping: { id: string; planeIssueId: string | null; asanaTaskGid: string | null; projectMapping: { planeProjectId: string } },
  planeClient: ReturnType<typeof getPlaneClient>,
  asanaClient: ReturnType<typeof getAsanaClient>
) {
  if (!taskMapping.asanaTaskGid || !taskMapping.planeIssueId) return;

  // Get comments from Asana
  const asanaComments = await asanaClient.listTaskStories(taskMapping.asanaTaskGid);

  for (const comment of asanaComments) {
    // Check if already synced
    const existingSync = await prisma.commentSync.findFirst({
      where: {
        sourceSystem: "asana",
        sourceCommentId: comment.gid,
      },
    });

    if (existingSync) continue;

    // Create comment in Plane
    const commentHtml = `<p>[From Asana - ${comment.created_by?.name || "Unknown"}] ${comment.text || ""}</p>`;
    const planeComment = await planeClient.createComment(
      taskMapping.projectMapping.planeProjectId,
      taskMapping.planeIssueId,
      commentHtml
    );

    // Record the sync
    await prisma.commentSync.create({
      data: {
        taskMappingId: taskMapping.id,
        sourceSystem: "asana",
        sourceCommentId: comment.gid,
        targetCommentId: planeComment.id,
      },
    });
  }
}

// Simple HTML stripper
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
