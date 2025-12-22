export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'TEXT_INPUT' | 'MATCHING' | 'FILL_BLANKS';

export interface BaseQuizQuestion {
  id: string;
  type: QuestionType;
  question: string;
  explanation?: string;
}

export interface ChoiceQuizQuestion extends BaseQuizQuestion {
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  options: string[];
  correctAnswers: number[];
}

export interface TextInputQuizQuestion extends BaseQuizQuestion {
  type: 'TEXT_INPUT';
  correctAnswer: string;
  caseSensitive?: boolean;
}

export interface MatchingQuizQuestion extends BaseQuizQuestion {
  type: 'MATCHING';
  pairs: Array<{
    left: string;
    right: string;
  }>;
}

export interface FillBlanksQuizQuestion extends BaseQuizQuestion {
  type: 'FILL_BLANKS';
  text: string; // Text with [blank] placeholders
  answers: string[]; // Answers in order of appearance
}

export type QuizQuestion = ChoiceQuizQuestion | TextInputQuizQuestion | MatchingQuizQuestion | FillBlanksQuizQuestion;

export interface QuizContent {
  questions: QuizQuestion[];
  shuffleQuestions?: boolean;
  passingScore?: number;
}

export interface CourseContent {
  id: string;
  courseId: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ';
  content: string | QuizContent;
  order: number;
  parentId: string | null;
  subContents?: CourseContent[];
  completed?: boolean;
}
