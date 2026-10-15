-- Private course questions never enter the public Post/Comment surfaces.
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
  CONSTRAINT "CourseQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseQuestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseQuestion_courseId_authorId_requestId_key" ON "CourseQuestion"("courseId", "authorId", "requestId");
CREATE INDEX "CourseQuestion_courseId_createdAt_id_idx" ON "CourseQuestion"("courseId", "createdAt", "id");

CREATE TABLE "CourseAnswer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "questionId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hiddenAt" DATETIME,
  CONSTRAINT "CourseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseAnswer_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseAnswer_questionId_id_key" ON "CourseAnswer"("questionId", "id");
CREATE UNIQUE INDEX "CourseAnswer_questionId_authorId_requestId_key" ON "CourseAnswer"("questionId", "authorId", "requestId");
CREATE INDEX "CourseAnswer_questionId_createdAt_id_idx" ON "CourseAnswer"("questionId", "createdAt", "id");

CREATE TABLE "CourseQuestionSolution" (
  "questionId" TEXT NOT NULL PRIMARY KEY,
  "answerId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseQuestionSolution_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CourseQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourseQuestionSolution_questionId_answerId_fkey" FOREIGN KEY ("questionId", "answerId") REFERENCES "CourseAnswer"("questionId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourseQuestionSolution_answerId_key" ON "CourseQuestionSolution"("answerId");
CREATE UNIQUE INDEX "CourseQuestionSolution_revision_key" ON "CourseQuestionSolution"("revision");
CREATE UNIQUE INDEX "CourseQuestionSolution_questionId_answerId_key" ON "CourseQuestionSolution"("questionId", "answerId");
