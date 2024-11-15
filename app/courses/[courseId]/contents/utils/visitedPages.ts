export const getVisitedPagesKey = (courseId: string) => `visited-pages-${courseId}`;

export const markPageAsVisited = (courseId: string, contentId: string) => {
  if (typeof window === 'undefined') return;
  
  const key = getVisitedPagesKey(courseId);
  const visitedPages = getVisitedPages(courseId);
  if (!visitedPages.includes(contentId)) {
    visitedPages.push(contentId);
    localStorage.setItem(key, JSON.stringify(visitedPages));
  }
};

export const togglePageVisited = (courseId: string, contentId: string) => {
  if (typeof window === 'undefined') return;
  
  const key = getVisitedPagesKey(courseId);
  const visitedPages = getVisitedPages(courseId);
  const index = visitedPages.indexOf(contentId);
  
  if (index === -1) {
    visitedPages.push(contentId);
  } else {
    visitedPages.splice(index, 1);
  }
  
  localStorage.setItem(key, JSON.stringify(visitedPages));
  return index === -1; // returns true if page was marked as visited, false if unmarked
};

export const getVisitedPages = (courseId: string): string[] => {
  if (typeof window === 'undefined') return [];
  
  const key = getVisitedPagesKey(courseId);
  const visitedPages = localStorage.getItem(key);
  return visitedPages ? JSON.parse(visitedPages) : [];
};

export const isPageVisited = (courseId: string, contentId: string): boolean => {
  return getVisitedPages(courseId).includes(contentId);
};
