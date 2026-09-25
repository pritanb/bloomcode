import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Problem, Tag, ProblemList, Settings } from '../shared/contracts.js';
export const problems=sqliteTable('problems',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).$type<Problem>().notNull()});
export const attempts=sqliteTable('attempts',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),problemId:text('problem_id').notNull().references(()=>problems.id)});
export const tags=sqliteTable('tags',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).$type<Tag>().notNull()});
export const lists=sqliteTable('lists',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).$type<ProblemList>().notNull()});
export const problemTags=sqliteTable('problem_tags',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),problemId:text('problem_id').notNull().references(()=>problems.id),tagId:text('tag_id').notNull().references(()=>tags.id)});
export const listMemberships=sqliteTable('list_memberships',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),problemId:text('problem_id').notNull().references(()=>problems.id),listId:text('list_id').notNull().references(()=>lists.id)});
export const reviewTargets=sqliteTable('review_targets',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),problemId:text('problem_id').notNull().references(()=>problems.id)});
export const answerVersions=sqliteTable('answer_versions',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),attemptId:text('attempt_id').notNull().references(()=>attempts.id)});
export const auditEvents=sqliteTable('audit_events',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull()});
export const topics=sqliteTable('topics',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull()});
export const scoreDecisions=sqliteTable('score_decisions',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),topicId:text('topic_id').notNull().references(()=>topics.id),attemptId:text('attempt_id').references(()=>attempts.id)});
export const attemptTopics=sqliteTable('attempt_topics',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),topicId:text('topic_id').notNull().references(()=>topics.id),attemptId:text('attempt_id').notNull().references(()=>attempts.id)});
export const importBatches=sqliteTable('import_batches',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull()});
export const importRecords=sqliteTable('import_records',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),importId:text('import_id').notNull().references(()=>importBatches.id)});
export const importPlans=sqliteTable('import_plans',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),importId:text('import_id').notNull().references(()=>importBatches.id),problemId:text('problem_id').references(()=>problems.id)});
export const dailyPlans=sqliteTable('daily_plans',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull()});
export const planItems=sqliteTable('plan_items',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull(),planId:text('plan_id').notNull().references(()=>dailyPlans.id),problemId:text('problem_id').references(()=>problems.id),attemptId:text('attempt_id').references(()=>attempts.id)});
export const settings = sqliteTable('settings', { id:text('id').primaryKey(), data:text('data',{mode:'json'}).$type<Settings>().notNull() });

export const patterns=sqliteTable('patterns',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull()});

export const learningInsights=sqliteTable('learning_insights',{id:text('id').primaryKey(),data:text('data',{mode:'json'}).notNull()});
