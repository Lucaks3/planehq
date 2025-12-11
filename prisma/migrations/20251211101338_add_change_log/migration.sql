-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectMappingId" TEXT NOT NULL,
    "taskMappingId" TEXT,
    "planeIssueId" TEXT,
    "planeIssueName" TEXT,
    "asanaTaskGid" TEXT,
    "asanaTaskName" TEXT,
    "source" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" DATETIME,
    CONSTRAINT "ChangeLog_projectMappingId_fkey" FOREIGN KEY ("projectMappingId") REFERENCES "ProjectMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeLog_taskMappingId_fkey" FOREIGN KEY ("taskMappingId") REFERENCES "TaskMapping" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ChangeLog_projectMappingId_idx" ON "ChangeLog"("projectMappingId");

-- CreateIndex
CREATE INDEX "ChangeLog_taskMappingId_idx" ON "ChangeLog"("taskMappingId");

-- CreateIndex
CREATE INDEX "ChangeLog_detectedAt_idx" ON "ChangeLog"("detectedAt");
