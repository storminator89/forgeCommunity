import { learnerRoute, type LearnerContext } from '../helper';
import { optOutLearnerPractice } from '@/lib/server/formative-practice-learner';

export async function POST(_request: Request, context: LearnerContext) {
  return learnerRoute(context, optOutLearnerPractice);
}
