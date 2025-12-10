import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPlaneSignature } from "@/lib/plane-client";

interface PlaneWebhookPayload {
  event: string; // 'issue', 'project', etc.
  action: string; // 'create', 'update', 'delete'
  data: {
    id: string;
    name: string;
    project: string;
    state?: string;
    description_html?: string;
  };
  activity?: {
    field: string;
    old_value: string;
    new_value: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("x-plane-signature");

    // Verify webhook signature
    if (!verifyPlaneSignature(body, signature)) {
      console.error("Invalid Plane webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: PlaneWebhookPayload = JSON.parse(body);

    console.log("Plane webhook received:", {
      event: payload.event,
      action: payload.action,
      issueId: payload.data?.id,
    });

    // Only process issue/work-item events
    if (payload.event !== "issue") {
      return NextResponse.json({ received: true, skipped: true });
    }

    // Find project mapping for this Plane project
    const projectMapping = await prisma.projectMapping.findFirst({
      where: {
        planeProjectId: payload.data.project,
        syncEnabled: true,
      },
    });

    if (!projectMapping) {
      console.log("No project mapping found for Plane project:", payload.data.project);
      return NextResponse.json({ received: true, skipped: true });
    }

    // Check if this is a state change to the trigger state
    if (
      payload.action === "update" &&
      payload.activity?.field === "state"
    ) {
      // Get the state name from the new_value (might be ID, need to check)
      const newStateName = payload.activity.new_value;

      // Check if this matches the trigger state for this project
      if (
        newStateName.toLowerCase() === projectMapping.triggerStateName.toLowerCase()
      ) {
        console.log("Task reached trigger state, marking for sync:", payload.data.name);

        // Update or create task mapping with PENDING_ASANA_SYNC status
        await prisma.taskMapping.upsert({
          where: { planeIssueId: payload.data.id },
          update: {
            planeIssueName: payload.data.name,
            syncStatus: "PENDING_ASANA_SYNC",
          },
          create: {
            projectMappingId: projectMapping.id,
            planeIssueId: payload.data.id,
            planeIssueName: payload.data.name,
            syncStatus: "PENDING_ASANA_SYNC",
          },
        });

        // Log sync history
        const taskMapping = await prisma.taskMapping.findUnique({
          where: { planeIssueId: payload.data.id },
        });

        if (taskMapping) {
          await prisma.syncHistory.create({
            data: {
              taskMappingId: taskMapping.id,
              action: "trigger_state_reached",
              direction: "plane_to_asana",
              details: JSON.stringify({
                triggerState: projectMapping.triggerStateName,
                taskName: payload.data.name,
              }),
            },
          });
        }
      }
    }

    // Handle new issue creation - add to tracking
    if (payload.action === "create") {
      await prisma.taskMapping.upsert({
        where: { planeIssueId: payload.data.id },
        update: {
          planeIssueName: payload.data.name,
        },
        create: {
          projectMappingId: projectMapping.id,
          planeIssueId: payload.data.id,
          planeIssueName: payload.data.name,
          syncStatus: "UNMATCHED",
        },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error processing Plane webhook:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
