// A navigation hint only. The API also checks the current database role and
// test-account status, which are not both available in the client session.
export function canSeeLearnerPathways(role: string | null | undefined) {
  return role === 'USER';
}
