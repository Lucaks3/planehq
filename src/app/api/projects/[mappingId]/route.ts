import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface RouteParams {
  params: Promise<{ mappingId: string }>;
}

// DELETE /api/projects/[mappingId] - Delete a project mapping
export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    const { mappingId } = await params;

    // Delete the mapping (cascades to task mappings due to onDelete: Cascade)
    await prisma.projectMapping.delete({
      where: { id: mappingId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting project mapping:", error);
    return NextResponse.json(
      { error: "Failed to delete project mapping" },
      { status: 500 }
    );
  }
}
