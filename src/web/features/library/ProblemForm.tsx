import { tagColour } from '../../lib/tag-colour';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/select-field';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useState, type FormEvent } from 'react';
import type { Problem, ProblemList, Tag } from '../../../shared/contracts';
import { api } from '../../app/api';
import { ErrorNotice, Field, useAction } from '../../components/ui';

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
  const [selectedTags, setTags] = useState<Record<string, number | null>>(
    Object.fromEntries(problem?.tags.map((t) => [t.id, t.difficulty]) ?? []),
  );
  const [listIds, setListIds] = useState(problem?.lists.map((l) => l.id) ?? []);
  const [tagSearch, setTagSearch] = useState('');
  const createPattern = useAction(async () => {
    const tag = await api.send<Tag>('/tags', 'POST', { name: tagSearch.trim() });
    setTags((old) => ({ ...old, [tag.id]: null }));
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
      tags: Object.entries(selectedTags).map(([tagId, difficulty]) => ({
        tagId,
        difficulty,
      })),
      listIds,
    });
  }
  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
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
      <Field label="LeetCode topics">
        <Input
          value={leetcodeTopics}
          onChange={(event) => setLeetcodeTopics(event.target.value)}
          placeholder="Binary Search, Array"
        />
      </Field>
      <p className="small muted">
        Optional additional categories, separated by commas. Each tag below has its own notebook
        page.
      </p>
      <Field label="Question notes">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <fieldset>
        <legend>Tags & question difficulty</legend>
        <p className="small muted">
          Optional difficulty per pattern, from 1–10. This does not change your topic score.
        </p>
        <Field label="Find or create a tag">
          <Input maxLength={300} value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} />
        </Field>
        <div className="tag-choices">
          {tags
            .filter(
              (t) =>
                (!t.archived || t.id in selectedTags) &&
                t.name.toLowerCase().includes(tagSearch.toLowerCase()),
            )
            .map((t) => (
              <div className="tag-choice" key={t.id}>
                <Label>
                  <Checkbox
                    checked={t.id in selectedTags}
                    onCheckedChange={(checked) =>
                      setTags((old) => {
                        const next = { ...old };
                        if (checked === true) next[t.id] = null;
                        else delete next[t.id];
                        return next;
                      })
                    }
                  />
                  <span className="tag-colour tag-label" style={tagColour(t)}>
                    {t.name}
                  </span>
                  {t.archived ? ' (archived)' : ''}
                </Label>
                {t.id in selectedTags && (
                  <Input
                    aria-label={`${t.name} difficulty (1–10)`}
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    placeholder="Unknown"
                    value={selectedTags[t.id] ?? ''}
                    onChange={(e) =>
                      setTags({
                        ...selectedTags,
                        [t.id]: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                )}
              </div>
            ))}
        </div>
        {tagSearch.trim() &&
          !tags.some((tag) => tag.name.toLowerCase() === tagSearch.trim().toLowerCase()) && (
            <Button
              type="button"
              variant="outline"
              disabled={createPattern.isPending || pending}
              onClick={() => createPattern.mutate()}
            >
              Create tag “{tagSearch.trim()}”
            </Button>
          )}
        <ErrorNotice error={createPattern.error} />
        {!tags.length && (
          <p className="small muted">
            Create a tag to group questions and keep shared notebook notes.
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>List membership</legend>
        <div className="tag-choices">
          {lists.map((l) => (
            <Label className="check" key={l.id}>
              <Checkbox
                checked={listIds.includes(l.id)}
                onCheckedChange={(checked) =>
                  setListIds(
                    checked === true ? [...listIds, l.id] : listIds.filter((id) => id !== l.id),
                  )
                }
              />
              {l.name}
            </Label>
          ))}
        </div>
        {!lists.length && (
          <p className="small muted">No lists yet. Create a custom list in Manage tags & lists.</p>
        )}
      </fieldset>
      <ErrorNotice error={error} />
      <div className="row">
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
