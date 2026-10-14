import { useQuery } from '@tanstack/react-query';
import { Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TutorNote } from '../../../shared/tutor-notes';
import { api } from '../../app/api';
import { dateLabel, ErrorNotice, Loading, useAction } from '../../components/ui';
import { Panel, Subheading } from '../../components/kit';
import { Help } from './settings-parts';

/** Lessons the learner confirmed about Bloom's tutoring, grouped General first, then by topic. */
export function TutorLessons() {
  const query = useQuery({
    queryKey: ['tutor-notes'],
    queryFn: () => api.get<{ notes: TutorNote[]; total: number }>('/tutor-notes?all=true'),
  });
  const forget = useAction((id: string) => api.send(`/tutor-notes/${id}/forget`, 'POST', {}));
  const notes = query.data?.notes ?? [];
  const groups = [...new Set(notes.map((n) => n.topic))].map((topic) => ({
    topic,
    notes: notes.filter((n) => n.topic === topic),
  }));
  return (
    <Panel
      title="What Bloom has learned"
      icon={Lightbulb}
      meta={
        query.data
          ? `${query.data.total} ${query.data.total === 1 ? 'lesson' : 'lessons'}`
          : undefined
      }
    >
      <Help>
        Lessons you confirmed when you corrected or praised Bloom in chat. Bloom follows them in
        chat, coaching and your daily plan.
      </Help>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : !notes.length ? (
        <p className="rounded-2xl bg-muted px-4 py-3.5 text-[0.9375rem]">
          No lessons yet. When you tell Bloom what helped or what didn’t, it offers to remember it.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.topic ?? 'general'} className="flex flex-col gap-2">
              <Subheading>{group.topic ?? 'General'}</Subheading>
              <ul className="divide-y rounded-2xl border">
                {group.notes.map((note) => (
                  <li key={note.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.9375rem] leading-relaxed wrap-anywhere">{note.text}</p>
                      <p className="text-[0.8125rem] text-muted-foreground">
                        {note.version ? 'Updated' : 'Saved'} {dateLabel(note.updatedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={forget.isPending}
                      onClick={() => forget.mutate(note.id)}
                    >
                      Forget
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ErrorNotice error={forget.error} />
    </Panel>
  );
}
