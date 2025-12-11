import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPlaneClient } from "@/lib/plane-client";
import { getAsanaClient } from "@/lib/asana-client";

interface RouteParams {
  params: Promise<{ mappingId: string }>;
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

// POST /api/mappings/[mappingId]/import-from-asana
// Import unmatched Asana tasks into Plane
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;
    const body = await req.json();
    const { asanaTaskGids } = body; // Array of Asana task GIDs to import

    // Get the project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    const imported: { asanaTaskGid: string; planeIssueId: string; name: string }[] = [];
    const errors: { asanaTaskGid: string; error: string }[] = [];

    for (const asanaTaskGid of asanaTaskGids) {
      try {
        // Fetch the Asana task details
        const asanaTask = await asanaClient.getTask(asanaTaskGid);

        // Create a new issue in Plane with the Asana task name and description
        const planeIssue = await planeClient.createIssue(mapping.planeProjectId, {
          name: asanaTask.name,
          description_html: textToHtml(asanaTask.notes),
        });

        // Create task mapping linking them
        await prisma.taskMapping.create({
          data: {
            projectMappingId: mappingId,
            planeIssueId: planeIssue.id,
            planeIssueName: planeIssue.name,
            asanaTaskGid: asanaTaskGid,
            asanaTaskName: asanaTask.name,
            matchMethod: "imported",
            matchConfidence: 1.0,
            syncStatus: "SYNCED",
            lastSyncedAt: new Date(),
          },
        });

        imported.push({
          asanaTaskGid,
          planeIssueId: planeIssue.id,
          name: asanaTask.name,
        });

        // Sync comments from Asana to the new Plane issue
        const asanaComments = await asanaClient.listTaskStories(asanaTaskGid);
        for (const comment of asanaComments) {
          const commentHtml = `<p>[From Asana - ${comment.created_by?.name || "Unknown"}] ${comment.text || ""}</p>`;
          await planeClient.createComment(
            mapping.planeProjectId,
            planeIssue.id,
            commentHtml
          );
        }
      } catch (error) {
        console.error(`Error importing Asana task ${asanaTaskGid}:`, error);
        errors.push({
          asanaTaskGid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      imported,
      errors,
      summary: {
        total: asanaTaskGids.length,
        success: imported.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error importing from Asana:", error);
    return NextResponse.json(
      { error: "Failed to import tasks" },
      { status: 500 }
    );
  }
}
