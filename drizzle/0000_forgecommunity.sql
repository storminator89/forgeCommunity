-- CreateTable
CREATE TABLE "Endorsement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endorserId" TEXT NOT NULL,
    "endorsedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Endorsement_endorserId_fkey" FOREIGN KEY ("endorserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Endorsement_endorsedId_fkey" FOREIGN KEY ("endorsedId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "password" TEXT,
    "image" TEXT,
    "coverImage" TEXT,
    "bio" TEXT,
    "title" TEXT,
    "contact" TEXT,
    "endorsements" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "isTestAccount" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "resetPasswordToken" TEXT,
    "lastLogin" DATETIME,
    "socialLinks" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SiteAdminBootstrap" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'initial',
    "userId" TEXT NOT NULL,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteAdminBootstrap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
    "publicRankingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorAuthEnabled" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT 'LIGHT',
    "language" TEXT NOT NULL DEFAULT 'en',
    CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "authorId" TEXT NOT NULL,
    CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SpacePoll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "creatorId" TEXT,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "hiddenAt" DATETIME,
    "moderationRevision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SpacePoll_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpacePoll_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpacePollOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "SpacePollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SpacePoll" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpacePollVote" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("pollId", "userId"),
    CONSTRAINT "SpacePollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SpacePoll" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpacePollVote_pollId_optionId_fkey" FOREIGN KEY ("pollId", "optionId") REFERENCES "SpacePollOption" ("pollId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpacePollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpacePollVoteRequest" (
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("pollId", "userId", "requestId"),
    CONSTRAINT "SpacePollVoteRequest_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "SpacePoll" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpacePollVoteRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "creatorId" TEXT,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "weekStartsOn" TEXT,
    "weekTimezone" TEXT,
    "weekStartsAt" DATETIME,
    "weekEndsAt" DATETIME,
    "invitationAttemptCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SpaceMission_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaceMission_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionBookmarkSetting" (
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedAt" DATETIME,
    "revision" INTEGER NOT NULL,

    PRIMARY KEY ("missionId", "userId"),
    CONSTRAINT "SpaceMissionBookmarkSetting_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionBookmarkSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionBookmarkAccess" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "epoch" INTEGER NOT NULL,
    CONSTRAINT "SpaceMissionBookmarkAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionInvitationSetting" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "accountEpoch" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SpaceMissionInvitationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionInvitationAccess" (
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("missionId", "userId"),
    CONSTRAINT "SpaceMissionInvitationAccess_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionInvitationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionInvitationRequest" (
    "missionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,

    PRIMARY KEY ("missionId", "senderId", "requestId"),
    CONSTRAINT "SpaceMissionInvitationRequest_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionInvitationRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionInvitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "senderId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME,
    "expiresAt" DATETIME,
    "senderEpoch" INTEGER,
    "senderAccessEpoch" INTEGER,
    "senderAccountEpoch" INTEGER,
    "recipientAccessEpoch" INTEGER,
    "recipientAccountEpoch" INTEGER,
    "recipientSettingRevision" INTEGER,
    "recipientEpoch" INTEGER,
    CONSTRAINT "SpaceMissionInvitation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionInvitation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionInvitation_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionParticipation" (
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" DATETIME,

    PRIMARY KEY ("missionId", "userId"),
    CONSTRAINT "SpaceMissionParticipation_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMissionContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "epoch" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "targetContributionId" TEXT,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" DATETIME,
    "withdrawnAt" DATETIME,
    CONSTRAINT "SpaceMissionContribution_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "SpaceMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionContribution_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMissionContribution_missionId_targetContributionId_fkey" FOREIGN KEY ("missionId", "targetContributionId") REFERENCES "SpaceMissionContribution" ("missionId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceMember" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("spaceId", "userId"),
    CONSTRAINT "SpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceDiscussion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hiddenAt" DATETIME,
    CONSTRAINT "SpaceDiscussion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SpaceDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpaceReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discussionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hiddenAt" DATETIME,
    CONSTRAINT "SpaceReply_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "SpaceDiscussion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SpaceReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcceptedSolution" (
    "postId" TEXT NOT NULL PRIMARY KEY,
    "commentId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcceptedSolution_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AcceptedSolution_postId_commentId_fkey" FOREIGN KEY ("postId", "commentId") REFERENCES "Comment" ("postId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AcceptedSolutionChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "postId" TEXT,
    "previousCommentId" TEXT,
    "commentId" TEXT,
    CONSTRAINT "AcceptedSolutionChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AcceptedSolutionChange_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AcceptedSolutionChange_previousCommentId_fkey" FOREIGN KEY ("previousCommentId") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AcceptedSolutionChange_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "scopeSpaceId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    "resolutionNote" TEXT
);

-- CreateTable
CREATE TABLE "LikePost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    CONSTRAINT "LikePost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LikePost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LikeComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    CONSTRAINT "LikeComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LikeComment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "price" REAL,
    "currency" TEXT,
    "maxStudents" INTEGER,
    "rewardEligible" BOOLEAN NOT NULL DEFAULT false,
    "rewardApprovalRevision" TEXT,
    "imageUrl" TEXT,
    "activePublicationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Course_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Course_activePublicationId_fkey" FOREIGN KEY ("activePublicationId") REFERENCES "CoursePublication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "orderInCourse" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "courseId" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "CourseContent_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseContent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CourseContent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "hiddenAt" DATETIME,
    "solutionRevision" TEXT,
    "contextPublicationId" TEXT,
    "contextContentId" TEXT,
    CONSTRAINT "CourseQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseQuestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" DATETIME,
    CONSTRAINT "CourseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseQuestionSolution" (
    "questionId" TEXT NOT NULL PRIMARY KEY,
    "answerId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseQuestionSolution_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseQuestionSolution_questionId_answerId_fkey" FOREIGN KEY ("questionId", "answerId") REFERENCES "CourseAnswer" ("questionId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionBankItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "latestRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionBankItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionBankRevision" (
    "itemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "questionJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("itemId", "revision"),
    CONSTRAINT "QuestionBankRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "QuestionBankItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseDraft" (
    "courseId" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "basePublicationId" TEXT,
    "payload" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "lastEditorId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseDraft_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseDraft_basePublicationId_fkey" FOREIGN KEY ("basePublicationId") REFERENCES "CoursePublication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoursePublication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "contentCount" INTEGER NOT NULL,
    "previousPublicationId" TEXT,
    "actorId" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoursePublication_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoursePublication_previousPublicationId_fkey" FOREIGN KEY ("previousPublicationId") REFERENCES "CoursePublication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationRequest" (
    "courseId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("courseId", "requestId"),
    CONSTRAINT "PublicationRequest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationRequest_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeObjective" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PracticeObjective_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "latestRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PracticeItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeItem_objectiveId_ownerId_fkey" FOREIGN KEY ("objectiveId", "ownerId") REFERENCES "PracticeObjective" ("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeItemRevision" (
    "itemId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("itemId", "revision"),
    CONSTRAINT "PracticeItemRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PracticeItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoursePracticeDraft" (
    "courseId" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "lastEditorId" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CoursePracticeDraft_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "coursePublicationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "payload" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeSnapshot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeSnapshot_coursePublicationId_courseId_fkey" FOREIGN KEY ("coursePublicationId", "courseId") REFERENCES "CoursePublication" ("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticePublicationRequest" (
    "courseId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("courseId", "requestId"),
    CONSTRAINT "PracticePublicationRequest_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticePublicationRequest_snapshotId_courseId_fkey" FOREIGN KEY ("snapshotId", "courseId") REFERENCES "PracticeSnapshot" ("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSetting" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetTokenHash" TEXT,
    "resetTokenExpiresAt" DATETIME,

    PRIMARY KEY ("userId", "courseId"),
    CONSTRAINT "PracticeLearnerSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLearnerSetting_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "pendingReservationId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PracticeLearnerSession_userId_courseId_fkey" FOREIGN KEY ("userId", "courseId") REFERENCES "PracticeLearnerSetting" ("userId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLearnerSession_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PracticeSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "shownAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeLearnerReservation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PracticeLearnerSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reservationId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "canContinue" BOOLEAN NOT NULL DEFAULT true,
    "confidence" TEXT,
    "nextDueAt" DATETIME NOT NULL,
    "answeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PracticeLearnerAnswer_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PracticeLearnerReservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSubmissionReceipt" (
    "sessionId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("sessionId", "submissionId"),
    CONSTRAINT "PracticeLearnerSubmissionReceipt_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "PracticeLearnerAnswer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeLearnerSchedule" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemRevision" INTEGER NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastAnsweredAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "courseId", "snapshotId", "itemId"),
    CONSTRAINT "PracticeLearnerSchedule_userId_courseId_fkey" FOREIGN KEY ("userId", "courseId") REFERENCES "PracticeLearnerSetting" ("userId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeLearnerSchedule_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PracticeSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PracticeRetentionHealth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSuccessAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CourseAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "uploaderId" TEXT,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseAsset_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseContentProgress" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("userId", "contentId"),
    CONSTRAINT "CourseContentProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseContentProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseContentProgress_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "CourseContent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answerDigest" TEXT NOT NULL,
    "confidenceDigest" TEXT,
    "revision" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicationId" TEXT,
    CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizAttempt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizAttempt_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuizAttemptItemEvidence" (
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "confidence" TEXT,

    PRIMARY KEY ("attemptId", "questionId"),
    CONSTRAINT "QuizAttemptItemEvidence_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "passingScore" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "responseDigest" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentSubmission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssignmentSubmission_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssignmentGradeDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "graderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "score" INTEGER,
    "feedback" TEXT,
    "sequence" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentGradeDecision_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "enrolledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RewardLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 1,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "RewardLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RewardLedgerChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ledgerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "pointsDelta" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardLedgerChange_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "RewardLedger" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseCompletionRecord" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseTitle" TEXT NOT NULL,
    "completedAt" DATETIME NOT NULL,

    PRIMARY KEY ("userId", "courseId"),
    CONSTRAINT "CourseCompletionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningGoal" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "targetLeaves" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "pausedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningPathway" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "badgeLabel" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" DATETIME
);

-- CreateTable
CREATE TABLE "LearningPathwayCourse" (
    "pathwayId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    PRIMARY KEY ("pathwayId", "position"),
    CONSTRAINT "LearningPathwayCourse_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "LearningPathway" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningPathwayParticipation" (
    "userId" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" DATETIME,
    "badgeActive" BOOLEAN NOT NULL DEFAULT false,
    "badgeFirstAwardedAt" DATETIME,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("userId", "pathwayId"),
    CONSTRAINT "LearningPathwayParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningPathwayParticipation_pathwayId_fkey" FOREIGN KEY ("pathwayId") REFERENCES "LearningPathway" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningPathwayChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningPathwayChange_userId_pathwayId_fkey" FOREIGN KEY ("userId", "pathwayId") REFERENCES "LearningPathwayParticipation" ("userId", "pathwayId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "location" TEXT NOT NULL,
    "maxAttendees" INTEGER,
    "category" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventWaitlist" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventWaitlist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChatReadCursor" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadCreatedAt" DATETIME,
    "lastReadId" TEXT,

    PRIMARY KEY ("userId", "channelId"),
    CONSTRAINT "ChatReadCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatReadCursor_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMember_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "imageUrl" TEXT,
    "messageType" TEXT NOT NULL DEFAULT 'text',
    CONSTRAINT "ChatMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Badge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "awardedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserBadge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "endorsements" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillEndorsement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endorserId" TEXT NOT NULL,
    "userSkillId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillEndorsement_endorserId_fkey" FOREIGN KEY ("endorserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillEndorsement_userSkillId_fkey" FOREIGN KEY ("userSkillId") REFERENCES "UserSkill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "featuredImage" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "link" TEXT NOT NULL,
    "imageUrl" TEXT,
    "gradientFrom" TEXT NOT NULL,
    "gradientTo" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "authorId" TEXT NOT NULL,
    CONSTRAINT "Project_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LikeProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "LikeProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LikeProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    CONSTRAINT "ProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Resource_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "H5PContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "H5PContent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "courseName" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "publicationId" TEXT,
    CONSTRAINT "Certificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Certificate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Certificate_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CoursePublication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_PostTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_PostTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_PostTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ArticleTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ArticleTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ArticleTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ProjectTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ProjectTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ProjectTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Endorsement_endorserId_endorsedId_key" ON "Endorsement"("endorserId", "endorsedId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SiteAdminBootstrap_userId_key" ON "SiteAdminBootstrap"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Post_createdAt_id_idx" ON "Post"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Post_published_createdAt_id_idx" ON "Post"("published", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Post_authorId_createdAt_id_idx" ON "Post"("authorId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_id_idx" ON "Comment"("postId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Comment_authorId_postId_idx" ON "Comment"("authorId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_postId_id_key" ON "Comment"("postId", "id");

-- CreateIndex
CREATE INDEX "SpacePoll_spaceId_createdAt_id_idx" ON "SpacePoll"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpacePoll_creatorId_createdAt_idx" ON "SpacePoll"("creatorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpacePoll_spaceId_requestId_key" ON "SpacePoll"("spaceId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "SpacePollOption_pollId_id_key" ON "SpacePollOption"("pollId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpacePollOption_pollId_position_key" ON "SpacePollOption"("pollId", "position");

-- CreateIndex
CREATE INDEX "SpacePollVote_pollId_optionId_idx" ON "SpacePollVote"("pollId", "optionId");

-- CreateIndex
CREATE INDEX "SpacePollVote_userId_idx" ON "SpacePollVote"("userId");

-- CreateIndex
CREATE INDEX "SpacePollVoteRequest_userId_createdAt_idx" ON "SpacePollVoteRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SpaceMission_spaceId_createdAt_id_idx" ON "SpaceMission"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMission_spaceId_requestId_key" ON "SpaceMission"("spaceId", "requestId");

-- CreateIndex
CREATE INDEX "SpaceMissionBookmarkSetting_userId_savedAt_idx" ON "SpaceMissionBookmarkSetting"("userId", "savedAt");

-- CreateIndex
CREATE INDEX "SpaceMissionInvitationAccess_userId_idx" ON "SpaceMissionInvitationAccess"("userId");

-- CreateIndex
CREATE INDEX "SpaceMissionInvitationRequest_senderId_missionId_idx" ON "SpaceMissionInvitationRequest"("senderId", "missionId");

-- CreateIndex
CREATE INDEX "SpaceMissionInvitation_recipient_pending_idx" ON "SpaceMissionInvitation"("recipientId", "state", "expiresAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpaceMissionInvitation_senderId_state_idx" ON "SpaceMissionInvitation"("senderId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMissionInvitation_missionId_recipientId_key" ON "SpaceMissionInvitation"("missionId", "recipientId");

-- CreateIndex
CREATE INDEX "SpaceMissionParticipation_userId_optedOutAt_idx" ON "SpaceMissionParticipation"("userId", "optedOutAt");

-- CreateIndex
CREATE INDEX "SpaceMissionParticipation_missionId_optedOutAt_idx" ON "SpaceMissionParticipation"("missionId", "optedOutAt");

-- CreateIndex
CREATE INDEX "SpaceMissionContribution_missionId_createdAt_id_idx" ON "SpaceMissionContribution"("missionId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpaceMissionContribution_missionId_authorId_epoch_kind_idx" ON "SpaceMissionContribution"("missionId", "authorId", "epoch", "kind");

-- CreateIndex
CREATE INDEX "SpaceMissionContribution_authorId_idx" ON "SpaceMissionContribution"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMissionContribution_missionId_id_key" ON "SpaceMissionContribution"("missionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceMissionContribution_missionId_authorId_requestId_key" ON "SpaceMissionContribution"("missionId", "authorId", "requestId");

-- CreateIndex
CREATE INDEX "SpaceMember_userId_spaceId_idx" ON "SpaceMember"("userId", "spaceId");

-- CreateIndex
CREATE INDEX "SpaceDiscussion_spaceId_createdAt_id_idx" ON "SpaceDiscussion"("spaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpaceDiscussion_authorId_idx" ON "SpaceDiscussion"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceDiscussion_spaceId_authorId_requestId_key" ON "SpaceDiscussion"("spaceId", "authorId", "requestId");

-- CreateIndex
CREATE INDEX "SpaceReply_discussionId_createdAt_id_idx" ON "SpaceReply"("discussionId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SpaceReply_authorId_idx" ON "SpaceReply"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceReply_discussionId_authorId_requestId_key" ON "SpaceReply"("discussionId", "authorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptedSolution_commentId_key" ON "AcceptedSolution"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptedSolution_revision_key" ON "AcceptedSolution"("revision");

-- CreateIndex
CREATE INDEX "AcceptedSolutionChange_postId_createdAt_idx" ON "AcceptedSolutionChange"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ContentReport_targetType_targetId_idx" ON "ContentReport"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ContentReport_scopeSpaceId_status_createdAt_idx" ON "ContentReport"("scopeSpaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentReport_reporterId_targetType_targetId_key" ON "ContentReport"("reporterId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "LikePost_postId_idx" ON "LikePost"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "LikePost_userId_postId_key" ON "LikePost"("userId", "postId");

-- CreateIndex
CREATE INDEX "LikeComment_commentId_idx" ON "LikeComment"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "LikeComment_userId_commentId_key" ON "LikeComment"("userId", "commentId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Course_activePublicationId_idx" ON "Course"("activePublicationId");

-- CreateIndex
CREATE INDEX "CourseContent_courseId_archivedAt_idx" ON "CourseContent"("courseId", "archivedAt");

-- CreateIndex
CREATE INDEX "CourseQuestion_courseId_createdAt_id_idx" ON "CourseQuestion"("courseId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CourseQuestion_lesson_scope_page_idx" ON "CourseQuestion"("courseId", "contextPublicationId", "contextContentId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseQuestion_courseId_authorId_requestId_key" ON "CourseQuestion"("courseId", "authorId", "requestId");

-- CreateIndex
CREATE INDEX "CourseAnswer_questionId_createdAt_id_idx" ON "CourseAnswer"("questionId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAnswer_questionId_id_key" ON "CourseAnswer"("questionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAnswer_questionId_authorId_requestId_key" ON "CourseAnswer"("questionId", "authorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseQuestionSolution_answerId_key" ON "CourseQuestionSolution"("answerId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseQuestionSolution_revision_key" ON "CourseQuestionSolution"("revision");

-- CreateIndex
CREATE UNIQUE INDEX "CourseQuestionSolution_questionId_answerId_key" ON "CourseQuestionSolution"("questionId", "answerId");

-- CreateIndex
CREATE INDEX "QuestionBankItem_ownerId_updatedAt_idx" ON "QuestionBankItem"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "CoursePublication_courseId_recordedAt_idx" ON "CoursePublication"("courseId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoursePublication_courseId_sequence_key" ON "CoursePublication"("courseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CoursePublication_id_courseId_key" ON "CoursePublication"("id", "courseId");

-- CreateIndex
CREATE INDEX "PublicationRequest_publicationId_idx" ON "PublicationRequest"("publicationId");

-- CreateIndex
CREATE INDEX "PracticeObjective_ownerId_updatedAt_idx" ON "PracticeObjective"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeObjective_id_ownerId_key" ON "PracticeObjective"("id", "ownerId");

-- CreateIndex
CREATE INDEX "PracticeItem_ownerId_updatedAt_idx" ON "PracticeItem"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "PracticeItem_objectiveId_idx" ON "PracticeItem"("objectiveId");

-- CreateIndex
CREATE INDEX "PracticeSnapshot_courseId_coursePublicationId_sequence_idx" ON "PracticeSnapshot"("courseId", "coursePublicationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeSnapshot_courseId_sequence_key" ON "PracticeSnapshot"("courseId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeSnapshot_id_courseId_key" ON "PracticeSnapshot"("id", "courseId");

-- CreateIndex
CREATE INDEX "PracticePublicationRequest_snapshotId_idx" ON "PracticePublicationRequest"("snapshotId");

-- CreateIndex
CREATE INDEX "PracticeLearnerSetting_lastActivityAt_idx" ON "PracticeLearnerSetting"("lastActivityAt");

-- CreateIndex
CREATE INDEX "PracticeLearnerSession_userId_courseId_status_idx" ON "PracticeLearnerSession"("userId", "courseId", "status");

-- CreateIndex
CREATE INDEX "PracticeLearnerSession_snapshotId_idx" ON "PracticeLearnerSession"("snapshotId");

-- CreateIndex
CREATE INDEX "PracticeLearnerReservation_itemId_itemRevision_idx" ON "PracticeLearnerReservation"("itemId", "itemRevision");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLearnerReservation_sessionId_ordinal_key" ON "PracticeLearnerReservation"("sessionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLearnerReservation_sessionId_itemId_key" ON "PracticeLearnerReservation"("sessionId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeLearnerAnswer_reservationId_key" ON "PracticeLearnerAnswer"("reservationId");

-- CreateIndex
CREATE INDEX "PracticeLearnerAnswer_answeredAt_idx" ON "PracticeLearnerAnswer"("answeredAt");

-- CreateIndex
CREATE INDEX "PracticeLearnerSubmissionReceipt_createdAt_idx" ON "PracticeLearnerSubmissionReceipt"("createdAt");

-- CreateIndex
CREATE INDEX "PracticeLearnerSchedule_userId_courseId_snapshotId_dueAt_idx" ON "PracticeLearnerSchedule"("userId", "courseId", "snapshotId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAsset_storageKey_key" ON "CourseAsset"("storageKey");

-- CreateIndex
CREATE INDEX "CourseAsset_courseId_idx" ON "CourseAsset"("courseId");

-- CreateIndex
CREATE INDEX "CourseContentProgress_userId_courseId_idx" ON "CourseContentProgress"("userId", "courseId");

-- CreateIndex
CREATE INDEX "CourseContentProgress_courseId_idx" ON "CourseContentProgress"("courseId");

-- CreateIndex
CREATE INDEX "CourseContentProgress_contentId_idx" ON "CourseContentProgress"("contentId");

-- CreateIndex
CREATE INDEX "QuizAttempt_userId_contentId_revision_submittedAt_idx" ON "QuizAttempt"("userId", "contentId", "revision", "submittedAt");

-- CreateIndex
CREATE INDEX "QuizAttempt_courseId_idx" ON "QuizAttempt"("courseId");

-- CreateIndex
CREATE INDEX "QuizAttempt_publicationId_idx" ON "QuizAttempt"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_userId_contentId_submissionId_key" ON "QuizAttempt"("userId", "contentId", "submissionId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_courseId_contentId_revision_userId_attemptNumber_idx" ON "AssignmentSubmission"("courseId", "contentId", "revision", "userId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_courseId_contentId_idx" ON "AssignmentSubmission"("courseId", "contentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_publicationId_idx" ON "AssignmentSubmission"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_userId_contentId_requestId_key" ON "AssignmentSubmission"("userId", "contentId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_userId_contentId_attemptNumber_key" ON "AssignmentSubmission"("userId", "contentId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AssignmentGradeDecision_createdAt_idx" ON "AssignmentGradeDecision"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentGradeDecision_submissionId_requestId_key" ON "AssignmentGradeDecision"("submissionId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentGradeDecision_submissionId_sequence_key" ON "AssignmentGradeDecision"("submissionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_courseId_key" ON "Enrollment"("userId", "courseId");

-- CreateIndex
CREATE INDEX "RewardLedger_userId_revokedAt_idx" ON "RewardLedger"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "RewardLedger_eventType_sourceId_idx" ON "RewardLedger"("eventType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_userId_eventType_sourceId_key" ON "RewardLedger"("userId", "eventType", "sourceId");

-- CreateIndex
CREATE INDEX "RewardLedgerChange_createdAt_idx" ON "RewardLedgerChange"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedgerChange_ledgerId_version_key" ON "RewardLedgerChange"("ledgerId", "version");

-- CreateIndex
CREATE INDEX "CourseCompletionRecord_userId_completedAt_idx" ON "CourseCompletionRecord"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "LearningPathwayCourse_courseId_idx" ON "LearningPathwayCourse"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathwayCourse_pathwayId_courseId_key" ON "LearningPathwayCourse"("pathwayId", "courseId");

-- CreateIndex
CREATE INDEX "LearningPathwayParticipation_pathwayId_idx" ON "LearningPathwayParticipation"("pathwayId");

-- CreateIndex
CREATE INDEX "LearningPathwayChange_createdAt_idx" ON "LearningPathwayChange"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPathwayChange_userId_pathwayId_version_key" ON "LearningPathwayChange"("userId", "pathwayId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendee_eventId_userId_key" ON "EventAttendee"("eventId", "userId");

-- CreateIndex
CREATE INDEX "EventWaitlist_eventId_id_idx" ON "EventWaitlist"("eventId", "id");

-- CreateIndex
CREATE INDEX "EventWaitlist_userId_idx" ON "EventWaitlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventWaitlist_eventId_userId_key" ON "EventWaitlist"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMember_userId_channelId_key" ON "ChatMember"("userId", "channelId");

-- CreateIndex
CREATE INDEX "ChatMessage_channelId_createdAt_id_idx" ON "ChatMessage"("channelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_userId_targetType_targetId_idx" ON "Notification"("userId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Badge_name_key" ON "Badge"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeId_key" ON "UserBadge"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserSkill_userId_skillId_key" ON "UserSkill"("userId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillEndorsement_endorserId_userSkillId_key" ON "SkillEndorsement"("endorserId", "userSkillId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE UNIQUE INDEX "LikeProject_userId_projectId_key" ON "LikeProject"("userId", "projectId");

-- CreateIndex
CREATE INDEX "Certificate_userId_idx" ON "Certificate"("userId");

-- CreateIndex
CREATE INDEX "Certificate_courseId_idx" ON "Certificate"("courseId");

-- CreateIndex
CREATE INDEX "Certificate_publicationId_idx" ON "Certificate"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "_PostTags_AB_unique" ON "_PostTags"("A", "B");

-- CreateIndex
CREATE INDEX "_PostTags_B_index" ON "_PostTags"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ArticleTags_AB_unique" ON "_ArticleTags"("A", "B");

-- CreateIndex
CREATE INDEX "_ArticleTags_B_index" ON "_ArticleTags"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ProjectTags_AB_unique" ON "_ProjectTags"("A", "B");

-- CreateIndex
CREATE INDEX "_ProjectTags_B_index" ON "_ProjectTags"("B");

