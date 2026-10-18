import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 登录账号。`id` 同时是 uploads/mistakes 里的 `user_id`，
// 播种时默认沿用历史值 "shiti"，否则老错题会因为查不到而看起来"消失"。
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  fileKeys: text("file_keys").notNull(),
  fileNames: text("file_names").notNull(),
  createdAt: text("created_at").notNull(),
});

export const mistakes = sqliteTable("mistakes", {
  id: text("id").primaryKey(),
  uploadId: text("upload_id").notNull().references(() => uploads.id),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  question: text("question").notNull(),
  incorrectAnswer: text("incorrect_answer").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  reasoning: text("reasoning").notNull(),
  knowledgePoint: text("knowledge_point").notNull(),
  pageNumber: integer("page_number").notNull(),
  sourceName: text("source_name").notNull(),
  similarQuestions: text("similar_questions").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});
