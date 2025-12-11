import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";
import { autoMatchAllTasks, SuggestedMatch } from "@/lib/matching";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mappingId: string }> }
) {
  try {
    const { mappingId } = await params;

    // Get project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    // Get existing task mappings
    const existingMappings = await prisma.taskMapping.findMany({
      where: { projectMappingId: mappingId },
    });

    const linkedPlaneIds = new Set(
      existingMappings.filter(m => m.planeIssueId).map(m => m.planeIssueId!)
    );
    const linkedAsanaGids = new Set(
      existingMappings.filter(m => m.asanaTaskGid).map(m => m.asanaTaskGid!)
    );

    // Fetch tasks from both systems with descriptions
    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    const [planeIssues, asanaTasks] = await Promise.all([
      planeClient.listIssues(mapping.planeProjectId).catch(() => []),
      asanaClient.listTasks(mapping.asanaProjectGid, mapping.asanaSectionName || undefined).catch(() => []),
    ]);

    // Convert to format expected by matching function
    const planeTasks = planeIssues.map((issue: any) => ({
      id: issue.id,
      name: issue.name,
      description: issue.description_stripped || issue.description_html || "",
    }));

    const asanaTasksFormatted = asanaTasks.map((task: any) => ({
      gid: task.gid,
      name: task.name,
      notes: task.notes || "",
    }));

    // Run auto-matching
    const suggestions = autoMatchAllTasks(
      planeTasks,
      asanaTasksFormatted,
      linkedPlaneIds,
      linkedAsanaGids,
      0.5 // Lower threshold to show more potential matches
    );

    return NextResponse.json({
      suggestions,
      stats: {
        totalPlaneTasks: planeTasks.length,
        totalAsanaTasks: asanaTasks.length,
        alreadyLinked: existingMappings.filter(m => m.planeIssueId && m.asanaTaskGid).length,
        suggestionsFound: suggestions.length,
      },
    });
  } catch (error) {
    console.error("Auto-match error:", error);
    return NextResponse.json(
      { error: "Failed to find matches" },
      { status: 500 }
    );
  }
}

// POST to apply selected suggestions
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mappingId: string }> }
) {
  try {
    const { mappingId } = await params;
    const body = await request.json();
    const { suggestions } = body as { suggestions: SuggestedMatch[] };

    if (!suggestions || !Array.isArray(suggestions)) {
      return NextResponse.json(
        { error: "suggestions array required" },
        { status: 400 }
      );
    }

    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    const results = [];

    for (const suggestion of suggestions) {
      // Check if either task is already linked
      const existingPlane = await prisma.taskMapping.findFirst({
        where: {
          projectMappingId: mappingId,
          planeIssueId: suggestion.planeTaskId,
          asanaTaskGid: { not: null },
        },
      });

      const existingAsana = await prisma.taskMapping.findFirst({
        where: {
          projectMappingId: mappingId,
          asanaTaskGid: suggestion.asanaTaskGid,
          planeIssueId: { not: null },
        },
      });

      if (existingPlane || existingAsana) {
        results.push({
          ...suggestion,
          status: "skipped",
          reason: "Already linked",
        });
        continue;
      }

      // Check for existing unlinked mappings to update
      const planeOnlyMapping = await prisma.taskMapping.findFirst({
        where: {
          projectMappingId: mappingId,
          planeIssueId: suggestion.planeTaskId,
          asanaTaskGid: null,
        },
      });

      const asanaOnlyMapping = await prisma.taskMapping.findFirst({
        where: {
          projectMappingId: mappingId,
          asanaTaskGid: suggestion.asanaTaskGid,
          planeIssueId: null,
        },
      });

      let taskMapping;

      if (planeOnlyMapping) {
        // Update existing Plane-only mapping
        taskMapping = await prisma.taskMapping.update({
          where: { id: planeOnlyMapping.id },
          data: {
            asanaTaskGid: suggestion.asanaTaskGid,
            asanaTaskName: suggestion.asanaTaskName,
            matchMethod: suggestion.matchMethod,
            matchConfidence: suggestion.confidence,
            syncStatus: "MATCHED",
          },
        });

        // Delete the Asana-only mapping if it exists
        if (asanaOnlyMapping) {
          await prisma.taskMapping.delete({ where: { id: asanaOnlyMapping.id } });
        }
      } else if (asanaOnlyMapping) {
        // Update existing Asana-only mapping
        taskMapping = await prisma.taskMapping.update({
          where: { id: asanaOnlyMapping.id },
          data: {
            planeIssueId: suggestion.planeTaskId,
            planeIssueName: suggestion.planeTaskName,
            matchMethod: suggestion.matchMethod,
            matchConfidence: suggestion.confidence,
            syncStatus: "MATCHED",
          },
        });
      } else {
        // Create new mapping
        taskMapping = await prisma.taskMapping.create({
          data: {
            projectMappingId: mappingId,
            planeIssueId: suggestion.planeTaskId,
            planeIssueName: suggestion.planeTaskName,
            asanaTaskGid: suggestion.asanaTaskGid,
            asanaTaskName: suggestion.asanaTaskName,
            matchMethod: suggestion.matchMethod,
            matchConfidence: suggestion.confidence,
            syncStatus: "MATCHED",
          },
        });
      }

      // Log the auto-link action
      await prisma.syncHistory.create({
        data: {
          taskMappingId: taskMapping.id,
          action: "auto_link",
          direction: "NONE",
          details: JSON.stringify({
            matchMethod: suggestion.matchMethod,
            confidence: suggestion.confidence,
            reason: suggestion.matchReason,
          }),
        },
      });

      results.push({
        ...suggestion,
        status: "linked",
        taskMappingId: taskMapping.id,
      });
    }

    return NextResponse.json({
      results,
      linked: results.filter(r => r.status === "linked").length,
      skipped: results.filter(r => r.status === "skipped").length,
    });
  } catch (error) {
    console.error("Apply auto-match error:", error);
    return NextResponse.json(
      { error: "Failed to apply matches" },
      { status: 500 }
    );
  }
}
