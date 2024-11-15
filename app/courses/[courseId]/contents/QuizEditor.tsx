'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PlusCircle, Trash2 } from 'lucide-react';
import { QuizContent, QuizQuestion } from './types';

interface QuizEditorProps {
  initialContent?: QuizContent | string;
  onSave: (content: QuizContent) => void;
}

export function QuizEditor({ initialContent, onSave }: QuizEditorProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => {
    if (typeof initialContent === 'string') {
      try {
        const parsed = JSON.parse(initialContent);
        return parsed.questions || [];
      } catch (e) {
        console.error('Failed to parse initial quiz content:', e);
        return [];
      }
    }
    return initialContent?.questions || [
      {
        id: '1',
        question: '',
        options: ['', ''],
        correctAnswer: 0,
        explanation: '',
      },
    ];
  });
  const [shuffleQuestions, setShuffleQuestions] = useState(initialContent?.shuffleQuestions || false);
  const [passingScore, setPassingScore] = useState(initialContent?.passingScore?.toString() || '70');

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        id: (questions.length + 1).toString(),
        question: '',
        options: ['', ''],
        correctAnswer: 0,
        explanation: '',
      },
    ]);
  };

  const removeQuestion = (index: number) => {
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const updateQuestion = (index: number, field: keyof QuizQuestion, value: any) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setQuestions(newQuestions);
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
    if (newQuestions[questionIndex].correctAnswer >= optionIndex) {
      newQuestions[questionIndex].correctAnswer = Math.max(0, newQuestions[questionIndex].correctAnswer - 1);
    }
    setQuestions(newQuestions);
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[questionIndex].options[optionIndex] = value;
    setQuestions(newQuestions);
  };

  const handleSave = () => {
    onSave({
      questions,
      shuffleQuestions,
      passingScore: parseInt(passingScore),
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Quiz Einstellungen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              checked={shuffleQuestions}
              onCheckedChange={setShuffleQuestions}
              id="shuffle-questions"
            />
            <Label htmlFor="shuffle-questions">Fragen mischen</Label>
          </div>
          <div className="space-y-2">
            <Label htmlFor="passing-score">Bestehensgrenze (%)</Label>
            <Input
              id="passing-score"
              type="number"
              min="0"
              max="100"
              value={passingScore}
              onChange={(e) => setPassingScore(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {questions.map((question, questionIndex) => (
        <Card key={question.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Frage {questionIndex + 1}</CardTitle>
            {questions.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeQuestion(questionIndex)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Frage</Label>
              <Textarea
                value={question.question}
                onChange={(e) => updateQuestion(questionIndex, 'question', e.target.value)}
                placeholder="Gib hier deine Frage ein..."
              />
            </div>

            <div className="space-y-4">
              <Label>Antwortmöglichkeiten</Label>
              {question.options.map((option, optionIndex) => (
                <div key={optionIndex} className="flex space-x-2">
                  <Input
                    value={option}
                    onChange={(e) => updateOption(questionIndex, optionIndex, e.target.value)}
                    placeholder={`Option ${optionIndex + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOption(questionIndex, optionIndex)}
                    disabled={question.options.length <= 2}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => addOption(questionIndex)}
              >
                Option hinzufügen
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Richtige Antwort</Label>
              <select
                className="w-full p-2 border rounded-md"
                value={question.correctAnswer}
                onChange={(e) => updateQuestion(questionIndex, 'correctAnswer', parseInt(e.target.value))}
              >
                {question.options.map((_, index) => (
                  <option key={index} value={index}>
                    Option {index + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Erklärung (optional)</Label>
              <Textarea
                value={question.explanation || ''}
                onChange={(e) => updateQuestion(questionIndex, 'explanation', e.target.value)}
                placeholder="Erkläre, warum diese Antwort richtig ist..."
              />
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-between">
        <Button onClick={addQuestion} variant="outline">
          <PlusCircle className="h-4 w-4 mr-2" />
          Neue Frage
        </Button>
        <Button onClick={handleSave}>Speichern</Button>
      </div>
    </div>
  );
}
