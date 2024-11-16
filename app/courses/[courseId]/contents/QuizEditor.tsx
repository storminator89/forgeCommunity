'use client';

import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { PlusCircle, Trash2, GripVertical, Eye, EyeOff, ArrowUpDown, ArrowUp, ArrowDown, CheckSquare, Square } from 'lucide-react';
import { QuizContent, QuizQuestion, QuestionType } from './types';
import { cn } from '@/lib/utils';
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface QuizEditorProps {
  initialContent?: QuizContent | string;
  onSave: (content: QuizContent) => void;
}

interface MatchingQuizQuestion extends QuizQuestion {
  pairs: { left: string; right: string }[];
}

interface TextInputQuizQuestion extends QuizQuestion {
  correctAnswer: string;
  caseSensitive: boolean;
}

interface FillBlanksQuizQuestion extends QuizQuestion {
  text: string;
  answers: string[];
}

interface ChoiceQuizQuestion extends QuizQuestion {
  options: string[];
  correctAnswers: number[];
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'SINGLE_CHOICE', label: 'Single Choice' },
  { value: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
  { value: 'TRUE_FALSE', label: 'True/False' },
  { value: 'TEXT_INPUT', label: 'Text Input' },
  { value: 'MATCHING', label: 'Matching' },
  { value: 'FILL_BLANKS', label: 'Fill in the Blanks' },
];

const createEmptyQuestion = (type: QuestionType = 'SINGLE_CHOICE'): QuizQuestion => {
  const baseQuestion = {
    id: crypto.randomUUID(),
    question: '',
    type,
  };

  switch (type) {
    case 'SINGLE_CHOICE':
    case 'MULTIPLE_CHOICE':
      return {
        ...baseQuestion,
        type,
        options: ['', ''],
        correctAnswers: [],
      };
    case 'TRUE_FALSE':
      return {
        ...baseQuestion,
        type,
        options: ['True', 'False'],
        correctAnswers: [0],
      };
    case 'TEXT_INPUT':
      return {
        ...baseQuestion,
        type,
        correctAnswer: '',
        caseSensitive: false,
      };
    case 'MATCHING':
      return {
        ...baseQuestion,
        type,
        pairs: [
          { left: '', right: '' },
          { left: '', right: '' }
        ],
      };
    case 'FILL_BLANKS':
      return {
        ...baseQuestion,
        type,
        text: '',
        answers: [''],
      };
    default:
      return {
        ...baseQuestion,
        type: 'SINGLE_CHOICE',
        options: ['', ''],
        correctAnswers: [],
      };
  }
};

const isMatchingQuestion = (q: QuizQuestion): q is MatchingQuizQuestion => q.type === 'MATCHING';
const isTextInputQuestion = (q: QuizQuestion): q is TextInputQuizQuestion => q.type === 'TEXT_INPUT';
const isFillBlanksQuestion = (q: QuizQuestion): q is FillBlanksQuizQuestion => q.type === 'FILL_BLANKS';
const isChoiceQuestion = (q: QuizQuestion): q is ChoiceQuizQuestion => 
  q.type === 'SINGLE_CHOICE' || q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE';

export function QuizEditor({ initialContent, onSave }: QuizEditorProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => {
    if (typeof initialContent === 'string') {
      try {
        const parsed = JSON.parse(initialContent);
        // Migrate old questions to new format
        return (parsed.questions || []).map((q: any) => ({
          ...q,
          type: q.type || 'SINGLE_CHOICE',
          correctAnswers: q.correctAnswers || (typeof q.correctAnswer === 'number' ? [q.correctAnswer] : [0])
        }));
      } catch (e) {
        console.error('Failed to parse initial quiz content:', e);
        return [];
      }
    }
    const initialQuestions = initialContent?.questions || [];
    // Migrate existing questions to new format
    return initialQuestions.map(q => ({
      ...q,
      type: q.type || 'SINGLE_CHOICE',
      correctAnswers: q.correctAnswers || (typeof q.correctAnswer === 'number' ? [q.correctAnswer] : [0])
    }));
  });
  
  const [shuffleQuestions, setShuffleQuestions] = useState(initialContent?.shuffleQuestions || false);
  const [passingScore, setPassingScore] = useState(initialContent?.passingScore?.toString() || '70');
  const [currentTab, setCurrentTab] = useState('edit');
  const [draggedQuestionIndex, setDraggedQuestionIndex] = useState<number | null>(null);
  const dragOverQuestionIndex = useRef<number | null>(null);

  const moveQuestion = (fromIndex: number, toIndex: number) => {
    const newQuestions = [...questions];
    const [movedQuestion] = newQuestions.splice(fromIndex, 1);
    newQuestions.splice(toIndex, 0, movedQuestion);
    setQuestions(newQuestions);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedQuestionIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragOverQuestionIndex.current = index;
  };

  const handleDragEnd = () => {
    if (draggedQuestionIndex !== null && dragOverQuestionIndex.current !== null) {
      moveQuestion(draggedQuestionIndex, dragOverQuestionIndex.current);
    }
    setDraggedQuestionIndex(null);
    dragOverQuestionIndex.current = null;
  };

  const addQuestion = () => {
    setQuestions([
      ...questions,
      createEmptyQuestion(),
    ]);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const updateQuestion = (questionIndex: number, field: string, value: any) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex) return q;

      if (field === 'type') {
        // When changing question type, create a new question of that type
        // while preserving the question text and explanation
        const newQuestion = createEmptyQuestion(value as QuestionType);
        return {
          ...newQuestion,
          id: q.id,
          question: q.question,
          explanation: q.explanation,
        };
      }

      return {
        ...q,
        [field]: value,
      };
    }));
  };

  const toggleCorrectAnswer = (questionIndex: number, optionIndex: number) => {
    const newQuestions = [...questions];
    const question = newQuestions[questionIndex];
    if (!question) return;
    
    // Ensure correctAnswers is an array
    if (!Array.isArray(question.correctAnswers)) {
      question.correctAnswers = [];
    }
    
    if (question.type === 'SINGLE_CHOICE' || question.type === 'TRUE_FALSE') {
      question.correctAnswers = [optionIndex];
    } else {
      const currentIndex = question.correctAnswers.indexOf(optionIndex);
      if (currentIndex === -1) {
        question.correctAnswers.push(optionIndex);
      } else {
        question.correctAnswers.splice(currentIndex, 1);
      }
      question.correctAnswers.sort();
    }
    
    setQuestions(newQuestions);
  };

  const isCorrectAnswer = (questionIndex: number, optionIndex: number) => {
    const question = questions[questionIndex];
    if (!question || !Array.isArray(question.correctAnswers)) return false;
    return question.correctAnswers.includes(optionIndex);
  };

  const addOption = (questionIndex: number) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].options.push('');
    setQuestions(newQuestions);
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].options = newQuestions[questionIndex].options.filter(
      (_, i) => i !== optionIndex
    );
    if (newQuestions[questionIndex].correctAnswers.includes(optionIndex)) {
      newQuestions[questionIndex].correctAnswers = newQuestions[questionIndex].correctAnswers.filter(answer => answer !== optionIndex);
    }
    setQuestions(newQuestions);
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].options[optionIndex] = value;
    setQuestions(newQuestions);
  };

  const moveQuestionUp = (index: number) => {
    if (index > 0) {
      moveQuestion(index, index - 1);
    }
  };

  const moveQuestionDown = (index: number) => {
    if (index < questions.length - 1) {
      moveQuestion(index, index + 1);
    }
  };

  const handleSave = () => {
    onSave({
      questions,
      shuffleQuestions,
      passingScore: parseInt(passingScore),
    });
  };

  const updateMatchingPair = (questionIndex: number, pairIndex: number, side: 'left' | 'right', value: string) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      const newPairs = [...q.pairs];
      newPairs[pairIndex] = {
        ...newPairs[pairIndex],
        [side]: value
      };
      return {
        ...q,
        pairs: newPairs
      };
    }));
  };

  const addMatchingPair = (questionIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      return {
        ...q,
        pairs: [...q.pairs, { left: '', right: '' }]
      };
    }));
  };

  const removeMatchingPair = (questionIndex: number, pairIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isMatchingQuestion(q)) return q;
      return {
        ...q,
        pairs: q.pairs.filter((_, index) => index !== pairIndex)
      };
    }));
  };

  const updateTextInputAnswer = (questionIndex: number, value: string) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isTextInputQuestion(q)) return q;
      return {
        ...q,
        correctAnswer: value
      };
    }));
  };

  const updateFillBlanksAnswer = (questionIndex: number, answerIndex: number, value: string) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      const newAnswers = [...q.answers];
      newAnswers[answerIndex] = value;
      return {
        ...q,
        answers: newAnswers
      };
    }));
  };

  const addFillBlanksAnswer = (questionIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      return {
        ...q,
        answers: [...q.answers, '']
      };
    }));
  };

  const removeFillBlanksAnswer = (questionIndex: number, answerIndex: number) => {
    setQuestions(questions.map((q, i) => {
      if (i !== questionIndex || !isFillBlanksQuestion(q)) return q;
      return {
        ...q,
        answers: q.answers.filter((_, index) => index !== answerIndex)
      };
    }));
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="edit" className="w-full" onValueChange={(value) => {
        if (value === "preview") {
          handleSave();
        }
      }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="edit">Bearbeiten</TabsTrigger>
          <TabsTrigger value="preview">Vorschau & Speichern</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5" />
                Quiz Einstellungen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <Label htmlFor="shuffleQuestions" className="font-medium">Fragen mischen</Label>
                <Switch
                  id="shuffleQuestions"
                  checked={shuffleQuestions}
                  onCheckedChange={setShuffleQuestions}
                />
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <Label htmlFor="passingScore" className="font-medium">Bestehensgrenze (%)</Label>
                <Input
                  id="passingScore"
                  type="number"
                  min="0"
                  max="100"
                  value={passingScore}
                  onChange={(e) => setPassingScore(e.target.value)}
                  className="w-full sm:w-24"
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-8">
            {questions.map((question, questionIndex) => (
              <Card
                key={question.id}
                className={cn(
                  "transition-all duration-200 hover:shadow-md",
                  draggedQuestionIndex === questionIndex && "opacity-50 scale-95",
                  "relative border-2",
                  draggedQuestionIndex !== null && dragOverQuestionIndex.current === questionIndex && "border-primary border-dashed"
                )}
                draggable
                onDragStart={(e) => handleDragStart(e, questionIndex)}
                onDragOver={(e) => handleDragOver(e, questionIndex)}
                onDragEnd={handleDragEnd}
              >
                <div className="absolute right-4 top-4 flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveQuestionUp(questionIndex)}
                    disabled={questionIndex === 0}
                    className="hover:bg-gray-100"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => moveQuestionDown(questionIndex)}
                    disabled={questionIndex === questions.length - 1}
                    className="hover:bg-gray-100"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeQuestion(questionIndex)}
                    className="hover:bg-red-100 text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <CardHeader className="cursor-move select-none">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-1">
                      <GripVertical className="h-5 w-5 text-gray-500" />
                      <CardTitle>Frage {questionIndex + 1}</CardTitle>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-base font-medium">Frage</Label>
                    <Textarea
                      value={question.question}
                      onChange={(e) => updateQuestion(questionIndex, 'question', e.target.value)}
                      placeholder="Geben Sie hier Ihre Frage ein..."
                      className="min-h-[100px] resize-y"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label className="text-base font-medium">Fragetyp</Label>
                    <Select
                      value={question.type}
                      onValueChange={(value) => updateQuestion(questionIndex, 'type', value)}
                      className="w-full"
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUESTION_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {question.type === 'MATCHING' && isMatchingQuestion(question) && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Paare</Label>
                      {question.pairs.map((pair, pairIndex) => (
                        <div key={pairIndex} className="flex items-center gap-3">
                          <Input
                            value={pair.left}
                            onChange={(e) => updateMatchingPair(questionIndex, pairIndex, 'left', e.target.value)}
                            placeholder="Linker Teil"
                            className="flex-1"
                          />
                          <Input
                            value={pair.right}
                            onChange={(e) => updateMatchingPair(questionIndex, pairIndex, 'right', e.target.value)}
                            placeholder="Rechter Teil"
                            className="flex-1"
                          />
                          {question.pairs.length > 2 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeMatchingPair(questionIndex, pairIndex)}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {question.pairs.length < 6 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => addMatchingPair(questionIndex)}
                          className="mt-2 w-full"
                        >
                          <PlusCircle className="h-4 w-4 mr-2" />
                          Paar hinzufügen
                        </Button>
                      )}
                    </div>
                  )}

                  {question.type === 'TEXT_INPUT' && isTextInputQuestion(question) && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Richtige Antwort</Label>
                      <Input
                        value={question.correctAnswer}
                        onChange={(e) => updateTextInputAnswer(questionIndex, e.target.value)}
                        placeholder="Geben Sie die richtige Antwort ein"
                        className="w-full"
                      />
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={`case-sensitive-${questionIndex}`}
                          checked={question.caseSensitive}
                          onCheckedChange={(checked) => 
                            updateQuestion(questionIndex, 'caseSensitive', checked)
                          }
                        />
                        <Label htmlFor={`case-sensitive-${questionIndex}`}>
                          Groß-/Kleinschreibung beachten
                        </Label>
                      </div>
                    </div>
                  )}

                  {question.type === 'FILL_BLANKS' && isFillBlanksQuestion(question) && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Text mit Lücken</Label>
                      <Textarea
                        value={question.text}
                        onChange={(e) => updateQuestion(questionIndex, 'text', e.target.value)}
                        placeholder="Text mit [Lücken] in eckigen Klammern"
                        className="min-h-[100px]"
                      />
                      <Label className="text-base font-medium">Antworten für Lücken</Label>
                      {question.answers.map((answer, answerIndex) => (
                        <div key={answerIndex} className="flex items-center gap-3">
                          <div className="bg-gray-100 rounded-full px-2 py-1 text-sm font-medium text-gray-600">
                            {answerIndex + 1}
                          </div>
                          <Input
                            value={answer}
                            onChange={(e) => updateFillBlanksAnswer(questionIndex, answerIndex, e.target.value)}
                            placeholder={`Antwort für Lücke ${answerIndex + 1}`}
                            className="flex-1"
                          />
                          {question.answers.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeFillBlanksAnswer(questionIndex, answerIndex)}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addFillBlanksAnswer(questionIndex)}
                        className="mt-2 w-full"
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Antwort hinzufügen
                      </Button>
                    </div>
                  )}

                  {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && (
                    <div className="space-y-3">
                      <Label className="text-base font-medium">Antwortmöglichkeiten</Label>
                      {question.options.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-3">
                          <div className="flex-1 flex items-center gap-3">
                            <div className="bg-gray-100 rounded-full px-2 py-1 text-sm font-medium text-gray-600">
                              {String.fromCharCode(65 + optionIndex)}
                            </div>
                            <Input
                              value={option}
                              onChange={(e) => updateOption(questionIndex, optionIndex, e.target.value)}
                              placeholder={`Option ${optionIndex + 1}`}
                              className={cn(
                                "flex-1",
                                isCorrectAnswer(questionIndex, optionIndex) && "border-green-500 ring-1 ring-green-500"
                              )}
                            />
                            <Button
                              variant={isCorrectAnswer(questionIndex, optionIndex) ? "default" : "outline"}
                              size="sm"
                              onClick={() => toggleCorrectAnswer(questionIndex, optionIndex)}
                              className={cn(
                                "min-w-[40px]",
                                isCorrectAnswer(questionIndex, optionIndex) && "bg-green-500 hover:bg-green-600"
                              )}
                            >
                              {question.type === 'MULTIPLE_CHOICE' ? (
                                isCorrectAnswer(questionIndex, optionIndex) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />
                              ) : (
                                "✓"
                              )}
                            </Button>
                            {question.options.length > 2 && question.type !== 'TRUE_FALSE' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeOption(questionIndex, optionIndex)}
                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {question.options.length < 6 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => addOption(questionIndex)}
                          className="mt-2 w-full"
                        >
                          <PlusCircle className="h-4 w-4 mr-2" />
                          Option hinzufügen
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-base font-medium">Erklärung (optional)</Label>
                    <Textarea
                      value={question.explanation}
                      onChange={(e) => updateQuestion(questionIndex, 'explanation', e.target.value)}
                      placeholder="Erklären Sie die richtige Antwort..."
                      className="min-h-[100px] resize-y"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Button
            onClick={addQuestion}
            className="mt-8 w-full"
            variant="outline"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Neue Frage
          </Button>
        </TabsContent>

        <TabsContent value="preview">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Quiz Vorschau
              </CardTitle>
            </CardHeader>
            <CardContent>
              {questions.map((question, index) => (
                <div key={question.id} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge variant="outline" className="font-normal">
                      {QUESTION_TYPES.find(t => t.value === question.type)?.label}
                    </Badge>
                  </div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-3">
                    <span className="bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center text-sm">
                      {index + 1}
                    </span>
                    {question.question}
                  </h3>
                  {question.type === 'TEXT_INPUT' && (
                    <div className="p-4 rounded-lg border transition-colors flex items-center gap-3">
                      <Input
                        value={question.correctAnswer}
                        readOnly
                        className="w-full"
                      />
                    </div>
                  )}
                  {question.type === 'MATCHING' && (
                    <div className="space-y-3">
                      {question.pairs.map((pair, pairIndex) => (
                        <div key={pairIndex} className="flex items-center gap-3">
                          <div className="bg-gray-100 rounded-full px-2 py-1 text-sm font-medium text-gray-600">
                            {String.fromCharCode(65 + pairIndex)}
                          </div>
                          <div className="flex-1">{pair.left}</div>
                          <div className="flex-1">{pair.right}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {question.type === 'FILL_BLANKS' && (
                    <div className="space-y-3">
                      <p className="text-lg font-normal">{question.text}</p>
                      {question.answers.map((answer, answerIndex) => (
                        <div key={answerIndex} className="flex items-center gap-3">
                          <div className="bg-gray-100 rounded-full px-2 py-1 text-sm font-medium text-gray-600">
                            {String.fromCharCode(65 + answerIndex)}
                          </div>
                          <div className="flex-1">{answer}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') && (
                    <div className="space-y-3">
                      {question.options.map((option, optIndex) => (
                        <div
                          key={optIndex}
                          className={cn(
                            "p-4 rounded-lg border transition-colors flex items-center gap-3",
                            isCorrectAnswer(index, optIndex)
                              ? "border-green-500 bg-green-50"
                              : "border-gray-200 hover:border-gray-300"
                          )}
                        >
                          <div className="bg-gray-100 rounded-full px-2 py-1 text-sm font-medium text-gray-600">
                            {String.fromCharCode(65 + optIndex)}
                          </div>
                          <div className="flex-1">{option}</div>
                          {isCorrectAnswer(index, optIndex) && (
                            <Badge className="bg-green-500">Richtig</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {question.explanation && (
                    <Alert className="mt-4 bg-blue-50 text-blue-800 border-blue-200">
                      <AlertDescription>{question.explanation}</AlertDescription>
                    </Alert>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
