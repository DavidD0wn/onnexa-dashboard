-- CreateTable
CREATE TABLE "MetaBotConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "pageId" TEXT,
    "pageAccessToken" TEXT,
    "igAccountId" TEXT,
    "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "replyToComments" BOOLEAN NOT NULL DEFAULT true,
    "replyToDMs" BOOLEAN NOT NULL DEFAULT true,
    "systemPrompt" TEXT,
    "signatureText" TEXT,
    "brandContext" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MetaConversation" (
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
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMsg" TEXT,
    "rawPayload" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaConversation_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MetaBotConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
