-- CreateTable
CREATE TABLE "MetaBotRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MetaConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT,
    "postId" TEXT,
    "commentId" TEXT,
    "threadId" TEXT,
    "inboundText" TEXT NOT NULL,
    "outboundText" TEXT,
    "ruleMatched" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "errorMsg" TEXT,
    "rawPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaConversation_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MetaBotConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_MetaConversation" ("commentId", "configId", "createdAt", "errorMsg", "id", "inboundText", "outboundText", "platform", "postId", "rawPayload", "senderId", "senderName", "status", "threadId", "type") SELECT "commentId", "configId", "createdAt", "errorMsg", "id", "inboundText", "outboundText", "platform", "postId", "rawPayload", "senderId", "senderName", "status", "threadId", "type" FROM "MetaConversation";
DROP TABLE "MetaConversation";
ALTER TABLE "new_MetaConversation" RENAME TO "MetaConversation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
