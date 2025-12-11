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

// HTML to plain text converter that preserves line breaks
function stripHtml(html: string | undefined): string {
  if (!html) return "";
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

interface RouteParams {
  params: Promise<{ mappingId: string }>;
}

// POST /api/mappings/[mappingId]/import-to-asana
// Import unmatched Plane tasks into Asana
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;
    const body = await req.json();
    const { planeIssueIds } = body; // Array of Plane issue IDs to import

    // Get the project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    const planeClient = getPlaneClient();
    const asanaClient = getAsanaClient();

    // Get section GID if section filter is set
    let sectionGid: string | undefined;
    if (mapping.asanaSectionName) {
      const section = await asanaClient.getSectionByName(
        mapping.asanaProjectGid,
        mapping.asanaSectionName
      );
      if (section) {
        sectionGid = section.gid;
      }
    }

    const imported: { planeIssueId: string; asanaTaskGid: string; name: string }[] = [];
    const errors: { planeIssueId: string; error: string }[] = [];

    for (const planeIssueId of planeIssueIds) {
      try {
        // Fetch the Plane issue details (with labels expanded)
        const planeIssue = await planeClient.getIssue(mapping.planeProjectId, planeIssueId);

        // Strip HTML from description for Asana notes (preserving line breaks)
        const notes = stripHtml(planeIssue.description_html) || undefined;

        // Build task name with labels and month: [label1, label2] - Dec - Task Name
        const labelPrefix = planeIssue.labels && planeIssue.labels.length > 0
          ? `[${planeIssue.labels.map(l => l.name).join(", ")}]`
          : null;
        const monthPrefix = getMonthAbbr(planeIssue.target_date);

        // Combine prefixes: [Labels] - Dec - Task Name
        const prefixes = [labelPrefix, monthPrefix].filter(Boolean).join(" - ");
        const asanaTaskName = prefixes ? `${prefixes} - ${planeIssue.name}` : planeIssue.name;

        // Create a new task in Asana with labels in the name
        const asanaTask = await asanaClient.createTask(
          mapping.asanaProjectGid,
          { name: asanaTaskName, notes },
          sectionGid
        );

        // Create task mapping linking them
        await prisma.taskMapping.create({
          data: {
            projectMappingId: mappingId,
            planeIssueId: planeIssueId,
            planeIssueName: planeIssue.name,
            asanaTaskGid: asanaTask.gid,
            asanaTaskName: asanaTask.name,
            matchMethod: "imported",
            matchConfidence: 1.0,
            syncStatus: "SYNCED",
            lastSyncedAt: new Date(),
          },
        });

        imported.push({
          planeIssueId,
          asanaTaskGid: asanaTask.gid,
          name: planeIssue.name,
        });

        // Sync comments from Plane to the new Asana task
        const planeComments = await planeClient.listComments(
          mapping.planeProjectId,
          planeIssueId
        );
        for (const comment of planeComments) {
          const commentText = stripHtml(comment.comment_html);
          await asanaClient.createComment(
            asanaTask.gid,
            `[From Plane] ${commentText}`
          );
        }
      } catch (error) {
        console.error(`Error importing Plane issue ${planeIssueId}:`, error);
        errors.push({
          planeIssueId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      imported,
      errors,
      summary: {
        total: planeIssueIds.length,
        success: imported.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error importing to Asana:", error);
    return NextResponse.json(
      { error: "Failed to import tasks" },
      { status: 500 }
    );
  }
}
