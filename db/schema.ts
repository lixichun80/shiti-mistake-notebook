import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 登录账号。`id` 同时是 uploads/mistakes 里的 `user_id`，
// 播种时默认沿用历史值 "shiti"，否则老错题会因为查不到而看起来"消失"。
//
// 加列时必须带 .default()：SQLite 的 `ALTER TABLE ADD COLUMN ... NOT NULL`
// 在表里已有数据、又没给默认值时会直接报错，迁移当场失败。而这里的表全都是
// 有存量数据的，所以 notNull 的列一律配默认值，一个都不能漏。
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
  // 'user' | 'admin'。管理员能进 /admin 管账号。
  role: text("role").notNull().default("user"),
  // 'active' | 'disabled'。停用后该账号的会话立刻失效（配合 sessionEpoch）。
  status: text("status").notNull().default("active"),
  // 会话版本号。管理员重置密码或停用账号时 +1，把这个用户已签发的 cookie 全部作废。
  // 会话本身是无状态的，不这么做的话旧 cookie 会一直有效到 30 天后过期。
  sessionEpoch: integer("session_epoch").notNull().default(0),
  // 可空：从没登录过就是 NULL，后台列表里显示成「从未登录」。
  lastLoginAt: text("last_login_at"),
  // 微信号，注册时必填，方便管理员主动添加。可空：老账号和管理员建的号可能没有。
  wechat: text("wechat"),
  // NULL = 长期可用（存量账号及管理员创建的账号）。自行注册的新账号有 7 天试用期。
  trialEndsAt: text("trial_ends_at"),
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
