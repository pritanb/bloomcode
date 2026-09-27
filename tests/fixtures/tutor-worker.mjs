import { createInterface } from 'node:readline';
let messages = [];
const emit = (type, id, data = {}) =>
  process.stdout.write(JSON.stringify({ v: 1, type, id, ...data }) + '\n');
const state = () => ({ conversationId: 'test-conversation', messages, proposals: [] });
emit('ready', null, state());
for await (const line of createInterface({ input: process.stdin })) {
  const req = JSON.parse(line);
  if (req.message === 'crash') process.exit(1);
  if (req.message === 'hang') continue;
  if (req.message === 'failed-step') {
    emit('error', req.id, {
      ...state(),
      message: 'Retry step',
      coaching: { id: 'coach', attemptId: 'attempt', status: 'active', needsRetry: true },
    });
    continue;
  }
  if (req.method === 'reply') {
    emit('activity', req.id, { message: 'Reading evidence…' });
    emit('delta', req.id, { text: 'Recorded evidence' });
    await new Promise((resolve) => setTimeout(resolve, req.message === 'slow' ? 5000 : 50));
    messages.push(
      { role: 'user', text: req.message },
      { role: 'assistant', text: 'Recorded evidence' },
    );
  }
  if (req.method === 'new') messages = [];
  emit('result', req.id, state());
}
