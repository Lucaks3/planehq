import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface RouteParams {
  params: Promise<{ mappingId: string }>;
}

// GET /api/mappings/[mappingId]/changes/history
// Get the full history of all detected changes
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "100");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Get project mapping
    const mapping = await prisma.projectMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) {
      return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
    }

    // Get total count
    const totalCount = await prisma.changeLog.count({
      where: { projectMappingId: mappingId },
    });

    // Get change history ordered by detection time (newest first)
    const changes = await prisma.changeLog.findMany({
      where: { projectMappingId: mappingId },
      orderBy: { detectedAt: "desc" },
      take: limit,
      skip: offset,
    });

    return NextResponse.json({
      changes,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + changes.length < totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching change history:", error);
    return NextResponse.json(
      { error: "Failed to fetch change history" },
      { status: 500 }
    );
  }
}

// DELETE /api/mappings/[mappingId]/changes/history
// Clear all change history for a mapping
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;

    const result = await prisma.changeLog.deleteMany({
      where: { projectMappingId: mappingId },
    });

    return NextResponse.json({
      message: `Deleted ${result.count} change log entries`,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error("Error clearing change history:", error);
    return NextResponse.json(
      { error: "Failed to clear change history" },
      { status: 500 }
    );
  }
}
