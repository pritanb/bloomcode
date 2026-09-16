import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SelectField, SelectOption } from '@/components/select-field';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Topic, TopicScoreHistory } from '../shared/contracts';
import { api } from './api';
import { dateLabel, Empty, ErrorNotice, Field, Loading } from './ui';
import { topicHistory } from './topic-history';

const axisDate = (time: number) => new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(time);
export function TopicProgress({ topics }: { topics: Topic[] }) {
  const [selected, setSelected] = useState('');
  const [showAll, setShowAll] = useState(false);
  const fallback = [...topics].sort((a, b) => (b.lastMovement?.date ?? '').localeCompare(a.lastMovement?.date ?? '') || a.name.localeCompare(b.name))[0];
  const topic = topics.find(t => t.id === selected) ?? fallback;
  const query = useQuery({
    queryKey: ['topic-history', topic?.id],
    queryFn: () => api.get<TopicScoreHistory>(`/topics/${topic!.id}/history`),
    enabled: !!topic,
  });
  if (!topic) return <Card className="panel"><Empty>No topics yet.</Empty></Card>;
  const { ordered, points } = topicHistory(query.data?.decisions ?? []);
  const latest = ordered.at(-1);
  const change = latest ? Math.round((latest.newScore - latest.oldScore) * 100) / 100 : null;
  const current = query.data?.topic ?? topic;
  const rows = [...ordered].reverse();
  return <>
    <Card className="panel topic-timeline">
      <div className="section-heading">
        <div><h2>Score over time</h2><p className="small muted">Track your progress in each topic.</p></div>
        <Field label="Topic">
          <SelectField value={topic.id} onValueChange={id => { setSelected(id); setShowAll(false); }}>
            {[...topics].sort((a, b) => a.name.localeCompare(b.name)).map(t => <SelectOption key={t.id} value={t.id}>{t.name}</SelectOption>)}
          </SelectField>
        </Field>
      </div>
      {query.isPending ? <Loading /> : query.isError ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : <>
        <div className="topic-chart-summary">
          <div><span className="small muted">Current score</span><strong>{current.score ?? 'Unrated'}{current.score !== null && <span> / 5</span>}</strong></div>
          <div><span className="small muted">Latest change</span><strong>{change === null ? '—' : change === 0 ? 'No change' : `${change > 0 ? '+' : ''}${change}`}</strong></div>
          <Button asChild variant="outline"><Link to={`/topics/${topic.id}`}>View topic details</Link></Button>
        </div>
        {points.length ? <>
          <ChartContainer config={{ score: { label: 'Score', color: 'var(--foreground)' } }} className="topic-score-chart" aria-label={`${topic.name} score history on a 1 to 5 scale`}>
            <LineChart data={points} accessibilityLayer margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="time" type="number" scale="time" domain={points.length === 1 ? [points[0].time - 86400000, points[0].time + 86400000] : ['dataMin', 'dataMax']} ticks={points.length === 1 ? [points[0].time] : undefined} tickFormatter={axisDate} tickLine={false} axisLine={false} minTickGap={45} tickMargin={12} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_label, payload) => dateLabel(payload[0]?.payload.date)} />} />
              <Line dataKey="score" type="stepAfter" stroke="var(--color-score)" strokeWidth={2} dot={{ r: 4, fill: 'var(--color-score)' }} activeDot={{ r: 6 }} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
          <p className="small muted">{points.length === 1 ? 'One recorded review so far.' : `${dateLabel(points[0].date)} – ${dateLabel(points.at(-1)!.date)}`} Each point is the final recorded score for that day.</p>
        </> : <Empty><h3>No dated score history yet</h3><p>Future score reviews will appear here.</p></Empty>}
      </>}
    </Card>
    {query.isSuccess && rows.length > 0 && <Card className="panel">
      <div className="section-heading"><h2>Score updates</h2><span className="small muted">{rows.length} recorded reviews</span></div>
      <div className="table-scroll"><Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Score</TableHead><TableHead>Change</TableHead></TableRow></TableHeader>
        <TableBody>{(showAll ? rows : rows.slice(0, 5)).map(d => <TableRow key={d.id}>
          <TableCell className="whitespace-nowrap">{dateLabel(d.date)}</TableCell>
          <TableCell className="whitespace-nowrap">{d.oldScore === d.newScore ? d.newScore : `${d.oldScore} → ${d.newScore}`}</TableCell>
          <TableCell>{d.newScore === d.oldScore ? 'No change' : `${d.newScore > d.oldScore ? '+' : ''}${Math.round((d.newScore - d.oldScore) * 100) / 100}`}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div>
      {rows.length > 5 && <Button variant="ghost" onClick={() => setShowAll(value => !value)}>{showAll ? 'Show fewer updates' : `Show all ${rows.length} updates`}</Button>}
    </Card>}
  </>;
}
