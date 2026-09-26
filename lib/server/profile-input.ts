import { z } from 'zod';

const socialUrl = z.union([z.string().max(2048).refine(value => {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}), z.null()]).transform(value => typeof value === 'string' ? value.trim() || null : null);

export const socialLinksInput = z.object({
  github: socialUrl.optional(),
  linkedin: socialUrl.optional(),
  twitter: socialUrl.optional(),
  website: socialUrl.optional(),
}).strict();

export const publicProfileInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  bio: z.string().max(10_000).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  contact: z.string().max(2048).nullable().optional(),
  image: z.string().max(256_000).nullable().optional(),
  socialLinks: socialLinksInput.optional(),
  skills: z.array(z.object({
    id: z.string().min(1),
    level: z.number().int().min(0).max(100),
  }).strict()).max(100).refine(skills => new Set(skills.map(skill => skill.id)).size === skills.length).optional(),
}).strict();

export const ownProfileInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase()).optional(),
  image: z.string().max(256_000).nullable().optional(),
  language: z.string().max(20).optional(),
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
}).strict();
