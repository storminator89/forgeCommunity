export interface CourseContent {
  id: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P';
  content: string;
  order: number;
  parentId: string | null;
  subContents?: CourseContent[];
}