import { z } from 'zod';
export const recommendationSchema = z.object({
 listId:z.string().min(1).nullable(),
 strategy:z.enum(['balanced','topic']),
 startTopic:z.string().min(1).nullable(),
 completed:z.enum(['legacy','exclude','refreshers']),
 refresherSlots:z.number().int().min(0).max(20),
}).strict();
export type RecommendationSettings = z.infer<typeof recommendationSchema>;
export const defaultRecommendations:RecommendationSettings = {listId:null,strategy:'balanced',startTopic:null,completed:'legacy',refresherSlots:1};
export interface RecommendationOptions {
 lists:{id:string;name:string}[];
 topics:{name:string;total:number;completed:number}[];
 currentTopic:string|null;
 orderDescription:string;
}
