-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "planeWorkspaceSlug" TEXT NOT NULL,
    "planeApiKey" TEXT NOT NULL,
    "asanaAccessToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProjectMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planeProjectId" TEXT NOT NULL,
    "planeProjectName" TEXT NOT NULL,
    "asanaProjectGid" TEXT NOT NULL,
    "asanaProjectName" TEXT NOT NULL,
    "triggerStateName" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "asanaWebhookGid" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectMappingId" TEXT NOT NULL,
    "planeIssueId" TEXT,
    "planeIssueName" TEXT,
    "asanaTaskGid" TEXT,
    "asanaTaskName" TEXT,
    "matchConfidence" REAL,
    "matchMethod" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "lastSyncedAt" DATETIME,
    "lastSyncError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskMapping_projectMappingId_fkey" FOREIGN KEY ("projectMappingId") REFERENCES "ProjectMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommentSync" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskMappingId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceCommentId" TEXT NOT NULL,
    "targetCommentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommentSync_taskMappingId_fkey" FOREIGN KEY ("taskMappingId") REFERENCES "TaskMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskMappingId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "direction" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncHistory_taskMappingId_fkey" FOREIGN KEY ("taskMappingId") REFERENCES "TaskMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMapping_planeProjectId_asanaProjectGid_key" ON "ProjectMapping"("planeProjectId", "asanaProjectGid");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMapping_planeIssueId_key" ON "TaskMapping"("planeIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMapping_asanaTaskGid_key" ON "TaskMapping"("asanaTaskGid");

-- CreateIndex
CREATE UNIQUE INDEX "CommentSync_sourceSystem_sourceCommentId_key" ON "CommentSync"("sourceSystem", "sourceCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_eventId_key" ON "WebhookEvent"("eventId");
