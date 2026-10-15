import { learnerRoute, type LearnerContext } from '../helper';
import { optInLearnerPractice } from '@/lib/server/formative-practice-learner';

export async function POST(_request: Request, context: LearnerContext) {
  return learnerRoute(context, optInLearnerPractice);
}
