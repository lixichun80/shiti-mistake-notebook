export type PracticeQuestion = {
  question: string;
  answer: string;
  explanation: string;
  knowledgePoint: string;
};

export type PublicPracticeQuestion = Pick<PracticeQuestion, "question" | "knowledgePoint">;

export type PracticeVerdict = "correct" | "incorrect" | "uncertain";

export type PracticeGrade = {
  index: number;
  verdict: PracticeVerdict;
  comment: string;
  answer: string;
  explanation: string;
  knowledgePoint: string;
};

export type PracticeSummary = {
  id: string;
  subject: string;
  unitName: string;
  gradeLevel: string;
  questionCount: number;
  createdAt: string;
  gradedAt: string | null;
  correctCount: number;
  incorrectCount: number;
  uncertainCount: number;
  wrongKnowledgePoints: string[];
};

export type PracticeDetail = PracticeSummary & {
  questions: PublicPracticeQuestion[];
  answers: string[];
  grading: PracticeGrade[];
};
