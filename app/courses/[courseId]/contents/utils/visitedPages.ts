const VISITED_PAGES_KEY = 'visitedPages';

interface VisitedPages {
  [courseId: string]: {
    [contentId: string]: boolean;
  };
}

function getVisitedPages(): VisitedPages {
  if (typeof window === 'undefined') return {};
  
  try {
    const stored = localStorage.getItem(VISITED_PAGES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error loading visited pages:', error);
    return {};
  }
}

function saveVisitedPages(pages: VisitedPages) {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(VISITED_PAGES_KEY, JSON.stringify(pages));
    window.dispatchEvent(new CustomEvent('visitedPagesChanged', {
      detail: { courseId: Object.keys(pages)[0] }
    }));
  } catch (error) {
    console.error('Error saving visited pages:', error);
  }
}

export function isPageVisited(courseId: string, contentId: string): boolean {
  const visitedPages = getVisitedPages();
  return !!(visitedPages[courseId]?.[contentId]);
}

export function markPageAsVisited(courseId: string, contentId: string) {
  const visitedPages = getVisitedPages();
  
  if (!visitedPages[courseId]) {
    visitedPages[courseId] = {};
  }
  
  visitedPages[courseId][contentId] = true;
  saveVisitedPages(visitedPages);
}

export function unmarkPageAsVisited(courseId: string, contentId: string) {
  const visitedPages = getVisitedPages();
  
  if (visitedPages[courseId]?.[contentId]) {
    delete visitedPages[courseId][contentId];
    saveVisitedPages(visitedPages);
  }
}

export function areAllPagesVisited(courseId: string, contentIds: string[]): boolean {
  return contentIds.every(id => isPageVisited(courseId, id));
}
