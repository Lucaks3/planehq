import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface AsanaWebhookEvent {
  user: { gid: string };
  resource: {
    gid: string;
    resource_type: string;
    resource_subtype?: string;
  };
  parent?: { gid: string };
  action: string;
  change?: {
    field: string;
    action: string;
    new_value?: unknown;
  };
}

interface AsanaWebhookPayload {
  events: AsanaWebhookEvent[];
}

export async function POST(req: NextRequest) {
  try {
    // Asana webhook handshake - respond with X-Hook-Secret header
    const hookSecret = req.headers.get("x-hook-secret");
    if (hookSecret) {
      console.log("Asana webhook handshake received");
      return new NextResponse(null, {
        status: 200,
        headers: {
          "X-Hook-Secret": hookSecret,
        },
      });
    }

    const body = await req.text();
    const payload: AsanaWebhookPayload = JSON.parse(body);

    console.log("Asana webhook received:", {
      eventCount: payload.events?.length,
    });

    if (!payload.events || payload.events.length === 0) {
      return NextResponse.json({ received: true });
    }

    for (const event of payload.events) {
      await processAsanaEvent(event);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error processing Asana webhook:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function processAsanaEvent(event: AsanaWebhookEvent) {
  const { resource, action, parent } = event;

  console.log("Processing Asana event:", {
    type: resource.resource_type,
    action,
    gid: resource.gid,
  });

  // Handle new task created
  if (resource.resource_type === "task" && action === "added") {
    // Find project mapping by Asana project
    // The parent.gid should be the project GID
    if (!parent?.gid) return;

    const projectMapping = await prisma.projectMapping.findFirst({
      where: {
        asanaProjectGid: parent.gid,
        syncEnabled: true,
      },
    });

    if (!projectMapping) {
      console.log("No project mapping found for Asana project:", parent.gid);
      return;
    }

    // Check if we already have this task mapped
    const existingMapping = await prisma.taskMapping.findUnique({
      where: { asanaTaskGid: resource.gid },
    });

    if (!existingMapping) {
      // New task from Asana - create mapping with PENDING_PLANE_SYNC status
      // We'll need to fetch the task name separately
      console.log("New Asana task detected:", resource.gid);

      await prisma.taskMapping.create({
        data: {
          projectMappingId: projectMapping.id,
          asanaTaskGid: resource.gid,
          asanaTaskName: "New task from Asana", // Will be updated when we fetch details
          syncStatus: "PENDING_PLANE_SYNC",
        },
      });

      // Log history
      const newMapping = await prisma.taskMapping.findUnique({
        where: { asanaTaskGid: resource.gid },
      });

      if (newMapping) {
        await prisma.syncHistory.create({
          data: {
            taskMappingId: newMapping.id,
            action: "new_task_from_asana",
            direction: "asana_to_plane",
            details: JSON.stringify({ asanaTaskGid: resource.gid }),
          },
        });
      }
    }
  }

  // Handle task changes
  if (resource.resource_type === "task" && action === "changed") {
    const existingMapping = await prisma.taskMapping.findUnique({
      where: { asanaTaskGid: resource.gid },
    });

    if (existingMapping && existingMapping.planeIssueId) {
      // Task is mapped, mark for potential sync
      console.log("Mapped Asana task changed:", resource.gid);

      // Could trigger re-sync here if needed
    }
  }

  // Handle new comments (stories)
  if (resource.resource_type === "story" && action === "added") {
    if (resource.resource_subtype === "comment_added" && parent?.gid) {
      // This is a comment on a task
      const taskMapping = await prisma.taskMapping.findUnique({
        where: { asanaTaskGid: parent.gid },
      });

      if (taskMapping && taskMapping.planeIssueId) {
        console.log("New comment on mapped task:", parent.gid);

        // Check if we've already synced this comment
        const existingSync = await prisma.commentSync.findFirst({
          where: {
            sourceSystem: "asana",
            sourceCommentId: resource.gid,
          },
        });

        if (!existingSync) {
          // Mark for comment sync
          await prisma.commentSync.create({
            data: {
              taskMappingId: taskMapping.id,
              sourceSystem: "asana",
              sourceCommentId: resource.gid,
            },
          });
        }
      }
    }
  }
}
