import { readJsonObject } from '@/lib/server/api-input';
import { nextLearnerPractice } from '@/lib/server/formative-practice-learner';
import { learnerRoute, type LearnerContext } from '../helper';

export async function POST(request: Request, context: LearnerContext) {
  return learnerRoute(context, async (courseId, userId) => {
    const body = await readJsonObject(request, 1024);
    return nextLearnerPractice(courseId, userId, body.sessionId);
  });
}
