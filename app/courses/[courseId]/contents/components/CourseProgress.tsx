import { CourseContent } from '../types';
import { isPageVisited } from '../utils/visitedPages';
import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CourseProgressProps {
  contents: CourseContent[];
  courseId: string;
}

export function CourseProgress({ contents, courseId }: CourseProgressProps) {
  const getTopicStatus = (topic: CourseContent) => {
    if (topic.subContents && topic.subContents.length > 0) {
      const allSubtopicsCompleted = topic.subContents.every(
        subTopic => isPageVisited(courseId, subTopic.id)
      );
      return {
        completed: allSubtopicsCompleted,
        partiallyCompleted: topic.subContents.some(
          subTopic => isPageVisited(courseId, subTopic.id)
        ),
      };
    }
    
    return {
      completed: isPageVisited(courseId, topic.id),
      partiallyCompleted: false,
    };
  };

  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
      <h3 className="font-semibold text-sm">Kursfortschritt</h3>
      <div className="space-y-2">
        {contents.map((topic) => {
          const status = getTopicStatus(topic);
          return (
            <div key={topic.id} className="space-y-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="flex items-center space-x-2 w-full text-left">
                    {status.completed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : status.partiallyCompleted ? (
                      <AlertCircle className="h-4 w-4 text-yellow-500" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="text-sm truncate">{topic.title}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {status.completed
                        ? "Alle Unterthemen abgeschlossen"
                        : status.partiallyCompleted
                        ? "Einige Unterthemen abgeschlossen"
                        : topic.subContents?.length 
                          ? "Keine Unterthemen abgeschlossen"
                          : "Noch nicht abgeschlossen"}
                    </p>
                    {topic.subContents && topic.subContents.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {topic.subContents.filter(sub => isPageVisited(courseId, sub.id)).length} von {topic.subContents.length} Unterthemen abgeschlossen
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              {topic.subContents && topic.subContents.length > 0 && (
                <div className="ml-6 space-y-1">
                  {topic.subContents.map((subTopic) => (
                    <TooltipProvider key={subTopic.id}>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center space-x-2 w-full text-left">
                          {isPageVisited(courseId, subTopic.id) ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          ) : (
                            <Circle className="h-3 w-3 text-gray-400" />
                          )}
                          <span className="text-xs text-muted-foreground truncate">
                            {subTopic.title}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {isPageVisited(courseId, subTopic.id)
                              ? "Abgeschlossen"
                              : "Noch nicht abgeschlossen"}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
