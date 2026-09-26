-- Existing UserSkill.endorsements totals predate endorser records and are retained.
CREATE TABLE "SkillEndorsement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endorserId" TEXT NOT NULL,
    "userSkillId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SkillEndorsement_endorserId_fkey" FOREIGN KEY ("endorserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillEndorsement_userSkillId_fkey" FOREIGN KEY ("userSkillId") REFERENCES "UserSkill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SkillEndorsement_endorserId_userSkillId_key" ON "SkillEndorsement"("endorserId", "userSkillId");
