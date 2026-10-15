import { readJsonObject } from '@/lib/server/api-input';
import { resetLearnerPractice } from '@/lib/server/formative-practice-learner';
import { learnerRoute, type LearnerContext } from '../helper';

export async function POST(request: Request, context: LearnerContext) {
  return learnerRoute(context, async (courseId, userId) => {
    const body = await readJsonObject(request, 1024);
    return resetLearnerPractice(courseId, userId, body.token, body.confirmation);
  });
}
