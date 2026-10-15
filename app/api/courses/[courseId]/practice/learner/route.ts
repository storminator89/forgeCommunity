import { learnerRoute, type LearnerContext } from './helper';
import { readLearnerPractice } from '@/lib/server/formative-practice-learner';

export async function GET(_request: Request, context: LearnerContext) {
  return learnerRoute(context, readLearnerPractice);
}
