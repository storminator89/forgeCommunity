-- Reserved after 0013 verified pathways. Existing attempt and certificate
-- records remain unchanged.
ALTER TABLE "QuizAttempt" ADD COLUMN "confidenceDigest" TEXT;

CREATE TABLE "QuizAttemptItemEvidence" (
  "attemptId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "correct" INTEGER NOT NULL CHECK ("correct" IN (0, 1)),
  "confidence" TEXT CHECK ("confidence" IN ('SURE', 'SOMEWHAT_SURE', 'UNSURE', 'GUESSED')),
  PRIMARY KEY ("attemptId", "questionId"),
  FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
