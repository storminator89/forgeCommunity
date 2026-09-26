import type { Prisma } from '@prisma/client';

export async function deleteCourseDependencies(tx: Prisma.TransactionClient, courseIds: string[]) {
  if (courseIds.length === 0) return;

  await tx.certificate.deleteMany({ where: { courseId: { in: courseIds } } });
  await tx.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });

  const contents = await tx.courseContent.findMany({
    where: { courseId: { in: courseIds } },
    select: { id: true, parentId: true },
  });
  const remaining = new Map(contents.map((content) => [content.id, content]));
  while (remaining.size) {
    const parents = new Set(
      [...remaining.values()].map((content) => content.parentId).filter((id): id is string => id !== null),
    );
    const leaves = [...remaining.keys()].filter((id) => !parents.has(id));
    if (!leaves.length) throw new Error('Invalid course content hierarchy');
    await tx.courseContent.deleteMany({ where: { id: { in: leaves } } });
    leaves.forEach((id) => remaining.delete(id));
  }

  await tx.lesson.deleteMany({ where: { courseId: { in: courseIds } } });
}
