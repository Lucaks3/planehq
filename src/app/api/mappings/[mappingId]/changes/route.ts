import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";

interface RouteParams {
  params: Promise<{ mappingId: string }>;
}

interface Change {
  taskMappingId: string;
  planeIssueId: string | null;
  planeIssueName: string | null;
  asanaTaskGid: string | null;
  asanaTaskName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: "plane" | "asana";
  changedAt: Date | null;
}

// Helper to add delay between API calls
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Batch fetch comments with rate limiting
// Returns map of taskId -> commentCount
async function fetchCommentCountsBatched(
  planeClient: ReturnType<typeof getPlaneClient>,
  asanaClient: ReturnType<typeof getAsanaClient>,
  projectId: string,
  tasks: { planeIssueId: string | null; asanaTaskGid: string | null }[],
  onlyModified: { planeIds: Set<string>; asanaIds: Set<string> } | null = null
): Promise<{ plane: Map<string, number>; asana: Map<string, number> }> {
  const planeComments = new Map<string, number>();
  const asanaComments = new Map<string, number>();

  // Filter to only tasks that need comment fetching
  const tasksToFetch = onlyModified
    ? tasks.filter(
        (t) =>
          (t.planeIssueId && onlyModified.planeIds.has(t.planeIssueId)) ||
          (t.asanaTaskGid && onlyModified.asanaIds.has(t.asanaTaskGid))
      )
    : tasks;

  // Batch in groups of 3 with 1500ms delay between batches to avoid rate limits
  // Plane: 60 req/min, Asana: 150 req/min
  const BATCH_SIZE = 3;
  const BATCH_DELAY = 1500;

  for (let i = 0; i < tasksToFetch.length; i += BATCH_SIZE) {
    const batch = tasksToFetch.slice(i, i + BATCH_SIZE);

    const promises = batch.flatMap((t) => {
      const fetches: Promise<void>[] = [];

      if (t.planeIssueId && (!onlyModified || onlyModified.planeIds.has(t.planeIssueId))) {
        fetches.push(
          planeClient
            .listComments(projectId, t.planeIssueId)
            .then((comments) => {
              planeComments.set(t.planeIssueId!, comments.length);
            })
            .catch(() => {
              planeComments.set(t.planeIssueId!, 0);
            })
        );
      }

      if (t.asanaTaskGid && (!onlyModified || onlyModified.asanaIds.has(t.asanaTaskGid))) {
        fetches.push(
          asanaClient
            .listTaskStories(t.asanaTaskGid)
            .then((stories) => {
              asanaComments.set(t.asanaTaskGid!, stories.length);
            })
            .catch(() => {
              asanaComments.set(t.asanaTaskGid!, 0);
            })
        );
      }

      return fetches;
    });

    await Promise.all(promises);

    // Add delay between batches to avoid rate limits
    if (i + BATCH_SIZE < tasksToFetch.length) {
      await delay(BATCH_DELAY);
    }
  }

  return { plane: planeComments, asana: asanaComments };
}

// GET /api/mappings/[mappingId]/changes
// Detect changes in linked tasks since last snapshot
// This version fetches tasks in bulk and compares, avoiding individual API calls
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;

    // Get project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    // Get all linked task mappings with their snapshots
    const taskMappings = await prisma.taskMapping.findMany({
      where: {
        projectMappingId: mappingId,
        planeIssueId: { not: null },
        asanaTaskGid: { not: null },
      },
      include: { snapshot: true },
    });

    if (taskMappings.length === 0) {
      return NextResponse.json({
        planeChanges: [],
        asanaChanges: [],
        summary: { planeChanges: 0, asanaChanges: 0, totalLinked: 0 },
      });
    }

    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    // Fetch all tasks in bulk (single API call each)
    const [planeIssues, asanaTasks] = await Promise.all([
      planeClient.listIssues(mapping.planeProjectId),
      asanaClient.listTasks(mapping.asanaProjectGid, mapping.asanaSectionName || undefined),
    ]);

    // Create lookup maps
    const planeIssueMap = new Map(planeIssues.map(i => [i.id, i]));
    const asanaTaskMap = new Map(asanaTasks.map(t => [t.gid, t]));

    const planeChanges: Change[] = [];
    const asanaChanges: Change[] = [];
    let missingCount = 0;

    // First pass: identify tasks that need comment checking
    // For Plane: we can rely on updated_at since it changes when comments are added
    // For Asana: modified_at does NOT update when comments are added (comments are "stories")
    // So we need to always check Asana comments for tasks that have a snapshot with comment count
    const modifiedPlaneIds = new Set<string>();
    const asanaIdsToCheck = new Set<string>();

    for (const tm of taskMappings) {
      if (!tm.planeIssueId || !tm.asanaTaskGid) continue;

      const planeIssue = planeIssueMap.get(tm.planeIssueId);
      const asanaTask = asanaTaskMap.get(tm.asanaTaskGid);
      const snapshot = tm.snapshot;

      if (!planeIssue || !asanaTask) continue;

      if (snapshot) {
        // Check if Plane task was modified since snapshot (includes comment changes)
        const planeModified = planeIssue.updated_at && snapshot.planeModifiedAt
          ? new Date(planeIssue.updated_at) > snapshot.planeModifiedAt
          : true;
        if (planeModified) {
          modifiedPlaneIds.add(tm.planeIssueId);
        }

        // For Asana: always check comments since modified_at doesn't update for comments
        // Only check if we have a baseline comment count to compare against
        if (snapshot.asanaCommentsCount !== null) {
          asanaIdsToCheck.add(tm.asanaTaskGid);
        }
      }
    }

    // Fetch comments for modified Plane tasks and ALL Asana tasks with snapshots
    const commentCounts = modifiedPlaneIds.size > 0 || asanaIdsToCheck.size > 0
      ? await fetchCommentCountsBatched(
          planeClient,
          asanaClient,
          mapping.planeProjectId,
          taskMappings.map((tm) => ({
            planeIssueId: tm.planeIssueId,
            asanaTaskGid: tm.asanaTaskGid,
          })),
          { planeIds: modifiedPlaneIds, asanaIds: asanaIdsToCheck }
        )
      : { plane: new Map<string, number>(), asana: new Map<string, number>() };

    for (const tm of taskMappings) {
      if (!tm.planeIssueId || !tm.asanaTaskGid) continue;

      const planeIssue = planeIssueMap.get(tm.planeIssueId);
      const asanaTask = asanaTaskMap.get(tm.asanaTaskGid);

      // Check if tasks still exist
      if (!planeIssue || !asanaTask) {
        missingCount++;
        continue;
      }

      const snapshot = tm.snapshot;

      // Helper to create change object with all fields
      const createChange = (
        field: string,
        oldValue: string | null,
        newValue: string | null,
        source: "plane" | "asana",
        changedAt: Date | null
      ): Change => ({
        taskMappingId: tm.id,
        planeIssueId: tm.planeIssueId,
        planeIssueName: planeIssue.name,
        asanaTaskGid: tm.asanaTaskGid,
        asanaTaskName: asanaTask.name,
        field,
        oldValue,
        newValue,
        source,
        changedAt,
      });

      if (snapshot) {
        // Check Plane changes
        if (snapshot.planeName !== planeIssue.name) {
          planeChanges.push(createChange(
            "name",
            snapshot.planeName,
            planeIssue.name,
            "plane",
            planeIssue.updated_at ? new Date(planeIssue.updated_at) : null
          ));
        }

        // Description changed
        const currentPlaneDesc = planeIssue.description_stripped || "";
        const snapshotPlaneDesc = snapshot.planeDescription || "";
        if (snapshotPlaneDesc !== currentPlaneDesc) {
          planeChanges.push(createChange(
            "description",
            snapshotPlaneDesc.substring(0, 100) + (snapshotPlaneDesc.length > 100 ? "..." : ""),
            currentPlaneDesc.substring(0, 100) + (currentPlaneDesc.length > 100 ? "..." : ""),
            "plane",
            planeIssue.updated_at ? new Date(planeIssue.updated_at) : null
          ));
        }

        // State changed
        const currentState = planeIssue.state_detail?.name || null;
        if (snapshot.planeState !== currentState) {
          planeChanges.push(createChange(
            "state",
            snapshot.planeState,
            currentState,
            "plane",
            planeIssue.updated_at ? new Date(planeIssue.updated_at) : null
          ));
        }

        // Plane comments changed
        const currentPlaneComments = commentCounts.plane.get(tm.planeIssueId);
        if (currentPlaneComments !== undefined && snapshot.planeCommentsCount !== currentPlaneComments) {
          planeChanges.push(createChange(
            "comments",
            `${snapshot.planeCommentsCount} comments`,
            `${currentPlaneComments} comments`,
            "plane",
            planeIssue.updated_at ? new Date(planeIssue.updated_at) : null
          ));
        }

        // Check Asana changes
        if (snapshot.asanaName !== asanaTask.name) {
          asanaChanges.push(createChange(
            "name",
            snapshot.asanaName,
            asanaTask.name,
            "asana",
            asanaTask.modified_at ? new Date(asanaTask.modified_at) : null
          ));
        }

        // Description changed
        const currentAsanaDesc = asanaTask.notes || "";
        const snapshotAsanaDesc = snapshot.asanaDescription || "";
        if (snapshotAsanaDesc !== currentAsanaDesc) {
          asanaChanges.push(createChange(
            "description",
            snapshotAsanaDesc.substring(0, 100) + (snapshotAsanaDesc.length > 100 ? "..." : ""),
            currentAsanaDesc.substring(0, 100) + (currentAsanaDesc.length > 100 ? "..." : ""),
            "asana",
            asanaTask.modified_at ? new Date(asanaTask.modified_at) : null
          ));
        }

        // Completion status changed
        if (snapshot.asanaCompleted !== asanaTask.completed) {
          asanaChanges.push(createChange(
            "completed",
            snapshot.asanaCompleted ? "Completed" : "Open",
            asanaTask.completed ? "Completed" : "Open",
            "asana",
            asanaTask.modified_at ? new Date(asanaTask.modified_at) : null
          ));
        }

        // Asana comments changed
        const currentAsanaComments = commentCounts.asana.get(tm.asanaTaskGid);
        if (currentAsanaComments !== undefined && snapshot.asanaCommentsCount !== currentAsanaComments) {
          asanaChanges.push(createChange(
            "comments",
            `${snapshot.asanaCommentsCount} comments`,
            `${currentAsanaComments} comments`,
            "asana",
            asanaTask.modified_at ? new Date(asanaTask.modified_at) : null
          ));
        }
      } else {
        // No snapshot yet - this is a new task, show as "new"
        planeChanges.push(createChange(
          "new",
          null,
          "New linked task - click Take Snapshot to start tracking",
          "plane",
          new Date()
        ));
      }
    }

    // Save all detected changes to the log (excluding "new" entries)
    const allChanges = [...planeChanges, ...asanaChanges].filter(c => c.field !== "new");
    if (allChanges.length > 0) {
      await prisma.changeLog.createMany({
        data: allChanges.map(change => ({
          projectMappingId: mappingId,
          taskMappingId: change.taskMappingId,
          planeIssueId: change.planeIssueId,
          planeIssueName: change.planeIssueName,
          asanaTaskGid: change.asanaTaskGid,
          asanaTaskName: change.asanaTaskName,
          source: change.source,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          changedAt: change.changedAt,
        })),
      });

      // Update snapshots for tasks that had changes so we don't log them again
      const changedTaskIds = new Set(allChanges.map(c => c.taskMappingId));
      for (const taskId of changedTaskIds) {
        const tm = taskMappings.find(t => t.id === taskId);
        if (!tm || !tm.planeIssueId || !tm.asanaTaskGid) continue;

        const planeIssue = planeIssueMap.get(tm.planeIssueId);
        const asanaTask = asanaTaskMap.get(tm.asanaTaskGid);
        if (!planeIssue || !asanaTask) continue;

        const planeCommentsCount = commentCounts.plane.get(tm.planeIssueId) ?? tm.snapshot?.planeCommentsCount ?? 0;
        const asanaCommentsCount = commentCounts.asana.get(tm.asanaTaskGid) ?? tm.snapshot?.asanaCommentsCount ?? 0;

        await prisma.taskSnapshot.upsert({
          where: { taskMappingId: taskId },
          create: {
            taskMappingId: taskId,
            planeName: planeIssue.name,
            planeDescription: planeIssue.description_stripped || "",
            planeState: planeIssue.state_detail?.name || null,
            planeModifiedAt: planeIssue.updated_at ? new Date(planeIssue.updated_at) : null,
            planeCommentsCount,
            asanaName: asanaTask.name,
            asanaDescription: asanaTask.notes || "",
            asanaCompleted: asanaTask.completed,
            asanaModifiedAt: asanaTask.modified_at ? new Date(asanaTask.modified_at) : null,
            asanaCommentsCount,
          },
          update: {
            planeName: planeIssue.name,
            planeDescription: planeIssue.description_stripped || "",
            planeState: planeIssue.state_detail?.name || null,
            planeModifiedAt: planeIssue.updated_at ? new Date(planeIssue.updated_at) : null,
            planeCommentsCount,
            asanaName: asanaTask.name,
            asanaDescription: asanaTask.notes || "",
            asanaCompleted: asanaTask.completed,
            asanaModifiedAt: asanaTask.modified_at ? new Date(asanaTask.modified_at) : null,
            asanaCommentsCount,
          },
        });
      }
    }

    return NextResponse.json({
      planeChanges,
      asanaChanges,
      summary: {
        planeChanges: planeChanges.length,
        asanaChanges: asanaChanges.length,
        totalLinked: taskMappings.length,
        missing: missingCount,
        logged: allChanges.length,
      },
    });
  } catch (error) {
    console.error("Error detecting changes:", error);
    return NextResponse.json(
      { error: "Failed to detect changes" },
      { status: 500 }
    );
  }
}

// POST /api/mappings/[mappingId]/changes
// Take a snapshot of current task state (call after syncing)
// This version fetches tasks in bulk to avoid rate limits
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;

    // Get project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    // Get all linked task mappings
    const taskMappings = await prisma.taskMapping.findMany({
      where: {
        projectMappingId: mappingId,
        planeIssueId: { not: null },
        asanaTaskGid: { not: null },
      },
    });

    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    // Fetch all tasks in bulk (single API call each)
    const [planeIssues, asanaTasks] = await Promise.all([
      planeClient.listIssues(mapping.planeProjectId),
      asanaClient.listTasks(mapping.asanaProjectGid, mapping.asanaSectionName || undefined),
    ]);

    // Create lookup maps
    const planeIssueMap = new Map(planeIssues.map(i => [i.id, i]));
    const asanaTaskMap = new Map(asanaTasks.map(t => [t.gid, t]));

    // Fetch comment counts for all tasks (batched to avoid rate limits)
    const commentCounts = await fetchCommentCountsBatched(
      planeClient,
      asanaClient,
      mapping.planeProjectId,
      taskMappings.map((tm) => ({
        planeIssueId: tm.planeIssueId,
        asanaTaskGid: tm.asanaTaskGid,
      }))
    );

    let snapshotCount = 0;
    let missingCount = 0;

    for (const tm of taskMappings) {
      if (!tm.planeIssueId || !tm.asanaTaskGid) continue;

      const planeIssue = planeIssueMap.get(tm.planeIssueId);
      const asanaTask = asanaTaskMap.get(tm.asanaTaskGid);

      if (!planeIssue || !asanaTask) {
        missingCount++;
        continue;
      }

      const planeCommentsCount = commentCounts.plane.get(tm.planeIssueId) ?? 0;
      const asanaCommentsCount = commentCounts.asana.get(tm.asanaTaskGid) ?? 0;

      // Upsert snapshot with comment counts
      await prisma.taskSnapshot.upsert({
        where: { taskMappingId: tm.id },
        create: {
          taskMappingId: tm.id,
          planeName: planeIssue.name,
          planeDescription: planeIssue.description_stripped || "",
          planeState: planeIssue.state_detail?.name || null,
          planeModifiedAt: planeIssue.updated_at ? new Date(planeIssue.updated_at) : null,
          planeCommentsCount,
          asanaName: asanaTask.name,
          asanaDescription: asanaTask.notes || "",
          asanaCompleted: asanaTask.completed,
          asanaModifiedAt: asanaTask.modified_at ? new Date(asanaTask.modified_at) : null,
          asanaCommentsCount,
        },
        update: {
          planeName: planeIssue.name,
          planeDescription: planeIssue.description_stripped || "",
          planeState: planeIssue.state_detail?.name || null,
          planeModifiedAt: planeIssue.updated_at ? new Date(planeIssue.updated_at) : null,
          planeCommentsCount,
          asanaName: asanaTask.name,
          asanaDescription: asanaTask.notes || "",
          asanaCompleted: asanaTask.completed,
          asanaModifiedAt: asanaTask.modified_at ? new Date(asanaTask.modified_at) : null,
          asanaCommentsCount,
        },
      });

      snapshotCount++;
    }

    return NextResponse.json({
      message: `Created/updated ${snapshotCount} snapshots${missingCount > 0 ? ` (${missingCount} tasks no longer exist)` : ""}`,
      snapshotCount,
      missingCount,
    });
  } catch (error) {
    console.error("Error creating snapshots:", error);
    return NextResponse.json(
      { error: "Failed to create snapshots" },
      { status: 500 }
    );
  }
}
