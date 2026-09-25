import { DateField } from '@/components/date-field';
import { SelectField, SelectOption } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReviewTarget } from '../../../shared/contracts';
import { api, ApiError } from '../../app/api';
import { dateLabel, ErrorNotice, Field, useAction } from '../../components/ui';

export function ReviewEditor({ review }: { review: ReviewTarget }) {
  const cache = useQueryClient();
  const [action, setAction] = useState(review.action);
  const [date, setDate] = useState(review.effectiveDate ?? '');
  const save = useAction(() =>
    api.send<ReviewTarget>(`/reviews/${review.id}`, 'PATCH', {
      version: review.version,
      action,
      date: action === 'none' || action === 'recommended' ? null : date,
    }),
  );
  return (
    <form
      className="review-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="row">
        <Field label="Review scheduling">
          <SelectField
            value={action}
            onValueChange={(value) => setAction(value as ReviewTarget['action'])}
          >
            <SelectOption value="recommended">Use recommendation</SelectOption>
            <SelectOption value="manual">Choose date</SelectOption>
            <SelectOption value="snooze">Snooze until</SelectOption>
            <SelectOption value="none">No scheduled review</SelectOption>
          </SelectField>
        </Field>
        {(action === 'manual' || action === 'snooze') && (
          <Field label="Review date">
            <DateField required value={date} onValueChange={setDate} />
          </Field>
        )}
        <Button variant="outline" disabled={save.isPending}>
          Save review date
        </Button>
      </div>
      <p className="small muted">
        Recommended: {review.recommendedDate ? dateLabel(review.recommendedDate) : 'Not scheduled'}.{' '}
        {review.constraint ?? ''}
      </p>
      <ErrorNotice error={save.error} />
      {save.error instanceof ApiError && save.error.status === 409 && (
        <div className="stack">
          <p className="small">
            This schedule changed elsewhere. Reload its latest choice before rescheduling.
          </p>
          <Button type="button" variant="outline" onClick={() => void cache.invalidateQueries()}>
            Reload latest schedule
          </Button>
        </div>
      )}
      {save.isSuccess && (
        <p role="status" className="positive">
          Review choice saved.
        </p>
      )}
    </form>
  );
}
