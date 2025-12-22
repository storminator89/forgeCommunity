// types/index.d.ts

export interface SocialLinks {
  github?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  website?: string | null;
}

export interface UserSettings {
  id: string;
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  theme: 'LIGHT' | 'DARK';
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Skill {
  id: string;
  name: string;
  level: number;
  endorsements: number;
}

export interface Badge {
  id: string;
  name: string;
  description: string;
  image: string;
  awardedAt: Date;
}

export interface UserStats {
  followers: number;
  following: number;
  posts: number;
  courses: number;
  projects: number;
  articles: number;
}

export interface User {
  id: string;
  name: string | null;
  email: string;
  emailVerified: Date | null;
  image: string | null;
  coverImage: string | null;
  bio: string | null;
  title: string | null;
  contact: string | null;
  endorsements: number;
  role: 'USER' | 'ADMIN' | 'MODERATOR' | 'INSTRUCTOR';
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
  socialLinks?: SocialLinks;
  settings?: UserSettings;
  skills: Skill[];
  badges: Badge[];
  stats: UserStats;
  teachingLanguages?: string[];
  expertise?: string[];
  averageRating?: number;
  isCurrentUser?: boolean;
  isFollowing?: boolean;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  instructor: {
    id: string;
    name: string;
    image?: string;
  };
  price?: number;
  currency?: string;
  startDate?: Date;
  endDate?: Date;
  category?: string;
  stats: {
    enrollments: number;
    maxStudents?: number;
    completionRate: number;
    rating: number;
    ratingCount: number;
    lessonsCount: number;
  };
  progress?: {
    completed: number;
    total: number;
    lastAccessed?: Date;
  };
  enrolled?: boolean;
  createdAt: Date;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  link: string;
  githubUrl?: string;
  category?: string;
  gradientFrom: string;
  gradientTo: string;
  tags: string[];
  author: {
    id: string;
    name: string;
    image?: string;
  };
  stats: {
    likes: number;
    comments: number;
  };
  isLiked: boolean;
  createdAt: Date;
}

export interface Activity {
  id: string;
  type: 'post' | 'comment' | 'project' | 'course';
  title?: string;
  content?: string;
  author: {
    id: string;
    name: string;
    image?: string;
  };
  target?: {
    id: string;
    type: string;
    title: string;
  };
  stats?: {
    likes?: number;
    comments?: number;
    views?: number;
  };
  createdAt: Date;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
    hasMore: boolean;
  };
}

// Form Types
export interface ProfileFormData {
  name: string;
  title: string | null;
  bio: string | null;
  contact: string | null;
}

export interface SocialLinksFormData {
  github?: string;
  linkedin?: string;
  twitter?: string;
  website?: string;
}

export interface UserSettingsFormData {
  emailNotifications: boolean;
  pushNotifications: boolean;
  theme: 'LIGHT' | 'DARK';
  language: string;
}

// Error Types
export interface ApiError {
  message: string;
  code?: string;
  field?: string;
}

// Notification Types
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  description?: string;
  duration?: number;
}