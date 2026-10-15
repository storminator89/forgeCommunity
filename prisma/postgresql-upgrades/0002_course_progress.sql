CREATE TABLE "CourseContentProgress" (
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseContentProgress_pkey" PRIMARY KEY ("userId", "contentId"),
    CONSTRAINT "CourseContentProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseContentProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseContentProgress_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "CourseContent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CourseContentProgress_userId_courseId_idx" ON "CourseContentProgress"("userId", "courseId");
CREATE INDEX "CourseContentProgress_courseId_idx" ON "CourseContentProgress"("courseId");
CREATE INDEX "CourseContentProgress_contentId_idx" ON "CourseContentProgress"("contentId");

CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "answerDigest" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuizAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuizAttempt_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "QuizAttempt_userId_contentId_submissionId_key" ON "QuizAttempt"("userId", "contentId", "submissionId");
CREATE INDEX "QuizAttempt_userId_contentId_revision_submittedAt_idx" ON "QuizAttempt"("userId", "contentId", "revision", "submittedAt");
CREATE INDEX "QuizAttempt_courseId_idx" ON "QuizAttempt"("courseId");
