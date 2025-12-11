-- CreateTable
CREATE TABLE "TaskSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskMappingId" TEXT NOT NULL,
    "planeName" TEXT,
    "planeDescription" TEXT,
    "planeState" TEXT,
    "planeModifiedAt" DATETIME,
    "planeCommentsCount" INTEGER NOT NULL DEFAULT 0,
    "asanaName" TEXT,
    "asanaDescription" TEXT,
    "asanaCompleted" BOOLEAN,
    "asanaModifiedAt" DATETIME,
    "asanaCommentsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskSnapshot_taskMappingId_fkey" FOREIGN KEY ("taskMappingId") REFERENCES "TaskMapping" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSnapshot_taskMappingId_key" ON "TaskSnapshot"("taskMappingId");
