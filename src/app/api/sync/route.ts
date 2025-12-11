import { NextRequest, NextResponse } from "next/server";
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

// Convert plain text to HTML, preserving line breaks
function textToHtml(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // Split by double newlines for paragraphs, single newlines become <br>
  return text
    .split(/\n\n+/)
    .map(para => {
      const withBr = para.replace(/\n/g, "<br>");
      return `<p>${withBr}</p>`;
    })
    .join("");
}

// POST /api/sync - Execute sync for a task mapping
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { taskMappingId, direction, syncComments = false } = body;

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
      await syncPlaneToAsana(taskMapping, syncComments);
    } else {
      await syncAsanaToPlane(taskMapping, syncComments);
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

async function syncPlaneToAsana(
  taskMapping: {
    id: string;
    planeIssueId: string | null;
    asanaTaskGid: string | null;
    projectMapping: {
      planeProjectId: string;
      asanaProjectGid: string;
    };
  },
  syncComments: boolean = false
) {
  if (!taskMapping.planeIssueId || !taskMapping.asanaTaskGid) {
    throw new Error("Task must be matched before syncing");
  }

  const planeClient = getPlaneClient();
  const asanaClient = getAsanaClient();

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

  // Update Asana task with name (including labels) and description
  const updateData: { name: string; notes?: string } = { name: asanaTaskName };
  if (planeIssue.description_html) {
    updateData.notes = stripHtml(planeIssue.description_html);
  }
  await asanaClient.updateTask(taskMapping.asanaTaskGid, updateData);

  // Only sync comments if explicitly enabled
  if (syncComments) {
    await syncCommentsPlaneToAsana(taskMapping, planeClient, asanaClient);
  }
}

async function syncAsanaToPlane(
  taskMapping: {
    id: string;
    planeIssueId: string | null;
    asanaTaskGid: string | null;
    projectMapping: {
      planeProjectId: string;
      asanaProjectGid: string;
    };
  },
  syncComments: boolean = false
) {
  if (!taskMapping.asanaTaskGid || !taskMapping.planeIssueId) {
    throw new Error("Task must be matched before syncing");
  }

  const planeClient = getPlaneClient();
  const asanaClient = getAsanaClient();

  // Fetch full Asana task details
  const asanaTask = await asanaClient.getTask(taskMapping.asanaTaskGid);

  // Update Plane issue with Asana description only (NOT name)
  const descriptionHtml = textToHtml(asanaTask.notes);
  if (descriptionHtml) {
    await planeClient.updateIssue(
      taskMapping.projectMapping.planeProjectId,
      taskMapping.planeIssueId,
      { description_html: descriptionHtml }
    );
  }

  // Only sync comments if explicitly enabled
  if (syncComments) {
    await syncCommentsAsanaToPlane(taskMapping, planeClient, asanaClient);
  }
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

// HTML to plain text converter that preserves line breaks
function stripHtml(html: string): string {
  return html
    // Convert block elements to newlines
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n---\n")
    // Handle list items with bullet points
    .replace(/<li[^>]*>/gi, "• ")
    // Remove all remaining HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up excessive whitespace while preserving intentional line breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n /g, "\n")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
