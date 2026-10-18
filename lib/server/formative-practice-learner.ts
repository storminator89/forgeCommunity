import 'server-only';

import { d1ReadLearnerPractice } from '@/lib/server/d1-formative-practice-learner-read';

// Sites uses native D1 batches for learner writes. Main retains its real
// Prisma transaction implementation; the public route and DTO contract stays.
export {
  optInLearnerPractice, pauseLearnerPractice, optOutLearnerPractice,
  startLearnerPractice, nextLearnerPractice, closeLearnerPractice,
  answerLearnerPractice, prepareLearnerPracticeReset, resetLearnerPractice,
} from '@/lib/server/d1-formative-practice-learner-mutations';

export async function readLearnerPractice(courseId: string, userId: string) {
  return d1ReadLearnerPractice(courseId, userId);
}
