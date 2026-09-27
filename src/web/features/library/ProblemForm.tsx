import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useState, type FormEvent } from 'react';
import type { Problem, ProblemList, Tag } from '../../../shared/contracts';
import { api } from '../../app/api';
import { ErrorNotice, Field, useAction } from '../../components/ui';
import { ChoicePill, TagDot } from './tags';

const legendClass = 'mb-3 font-heading text-[0.9375rem] font-semibold tracking-[-0.005em]';
const hintClass = 'text-[0.8125rem] text-muted-foreground';

export function ProblemForm({
  problem,
  tags,
  lists,
  onSave,
  onCancel,
  pending,
  error,
}: {
  problem?: Problem;
  tags: Tag[];
  lists: ProblemList[];
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  pending: boolean;
  error: unknown;
}) {
  const [title, setTitle] = useState(problem?.title ?? '');
  const [url, setUrl] = useState(problem?.url ?? '');
  const [difficulty, setDifficulty] = useState(problem?.difficulty ?? '');
  const [notes, setNotes] = useState(problem?.notes ?? '');
  const [leetcodeTopics, setLeetcodeTopics] = useState((problem?.leetcodeTopics ?? []).join(', '));
  const [tagIds, setTagIds] = useState(problem?.tags.map((t) => t.id) ?? []);
  const [listIds, setListIds] = useState(problem?.lists.map((l) => l.id) ?? []);
  const [tagSearch, setTagSearch] = useState('');
  const createPattern = useAction(async () => {
    const tag = await api.send<Tag>('/tags', 'POST', { name: tagSearch.trim() });
    setTagIds((old) => [...old, tag.id]);
    setTagSearch('');
    return tag;
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const enteredTopics = leetcodeTopics
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean);
    onSave({
      title,
      ...(!problem ? { url } : {}),
      difficulty: difficulty || null,
      notes,
      leetcodeTopics: enteredTopics,
      tags: tagIds.map((tagId) => ({ tagId })),
      listIds,
    });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
        <Field label="Question title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="LeetCode URL">
          <Input
            type="url"
            required
            readOnly={!!problem}
            value={url}
            placeholder="https://leetcode.com/problems/…/"
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label="LeetCode difficulty">
          <SelectField value={difficulty} onValueChange={(value) => setDifficulty(value)}>
            <SelectOption value="">Unknown</SelectOption>
            {['Easy', 'Medium', 'Hard'].map((v) => (
              <SelectOption key={v}>{v}</SelectOption>
            ))}
          </SelectField>
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <Field label="LeetCode topics">
          <Input
            value={leetcodeTopics}
            onChange={(event) => setLeetcodeTopics(event.target.value)}
            placeholder="Binary Search, Array"
          />
        </Field>
        <p className={hintClass}>
          Optional additional categories, separated by commas. Each tag below has its own notebook
          page.
        </p>
      </div>
      <Field label="Question notes">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className={legendClass}>Tags</legend>
        <Field label="Find or create a tag">
          <Input maxLength={300} value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {tags
            .filter(
              (t) =>
                (!t.archived || tagIds.includes(t.id)) &&
                t.name.toLowerCase().includes(tagSearch.toLowerCase()),
            )
            .map((t) => (
              <ChoicePill key={t.id}>
                <Checkbox
                  checked={tagIds.includes(t.id)}
                  onCheckedChange={(checked) =>
                    setTagIds((old) =>
                      checked === true ? [...old, t.id] : old.filter((id) => id !== t.id),
                    )
                  }
                />
                <TagDot hue={t.hue} />
                <span className="min-w-0 truncate">
                  {t.name}
                  {t.archived ? ' (archived)' : ''}
                </span>
              </ChoicePill>
            ))}
        </div>
        {tagSearch.trim() &&
          !tags.some((tag) => tag.name.toLowerCase() === tagSearch.trim().toLowerCase()) && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={createPattern.isPending || pending}
              onClick={() => createPattern.mutate()}
            >
              Create tag “{tagSearch.trim()}”
            </Button>
          )}
        <ErrorNotice error={createPattern.error} />
        {!tags.length && (
          <p className={hintClass}>
            Create a tag to group questions and keep shared notebook notes.
          </p>
        )}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className={legendClass}>List membership</legend>
        <div className="flex flex-wrap gap-2">
          {lists.map((l) => (
            <ChoicePill key={l.id}>
              <Checkbox
                checked={listIds.includes(l.id)}
                onCheckedChange={(checked) =>
                  setListIds(
                    checked === true ? [...listIds, l.id] : listIds.filter((id) => id !== l.id),
                  )
                }
              />
              {l.name}
            </ChoicePill>
          ))}
        </div>
        {!lists.length && (
          <p className={hintClass}>No lists yet. Create a custom list in Manage tags & lists.</p>
        )}
      </fieldset>
      <ErrorNotice error={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="default" disabled={pending}>
          {pending ? 'Saving…' : 'Save question'}
        </Button>
        <Button variant="outline" type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
