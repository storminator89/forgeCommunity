import { readJsonObject } from '@/lib/server/api-input';
import { PracticeError } from '@/lib/server/formative-practice';
import { closeLearnerPractice } from '@/lib/server/formative-practice-learner';
import { learnerRoute, type LearnerContext } from '../helper';

export async function POST(request: Request, context: LearnerContext) {
  return learnerRoute(context, async (courseId, userId) => {
    const body = await readJsonObject(request, 1024);
    if (Object.keys(body).some(key => key !== 'sessionId')) throw new PracticeError('Unerwartete Sitzungsdaten.');
    return closeLearnerPractice(courseId, userId, body.sessionId);
  });
}
