export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface QuizContent {
  questions: QuizQuestion[];
  shuffleQuestions?: boolean;
  passingScore?: number;
}

export interface CourseContent {
  id: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ';
  content: string | QuizContent;
  order: number;
  parentId: string | null;
  subContents?: CourseContent[];
}