import { learnerRoute, type LearnerContext } from '../helper';
import { pauseLearnerPractice } from '@/lib/server/formative-practice-learner';

export async function POST(_request: Request, context: LearnerContext) {
  return learnerRoute(context, pauseLearnerPractice);
}
