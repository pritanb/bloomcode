// Download or refresh the LeetCode problem bank in a running app (the same work as
// Settings → Recommendations). --dry-run fetches and fits without changing anything.
import { args, printJson, runCli } from '../src/integrations/cli.js';
import { LocalApi } from '../src/integrations/local-api.js';
import { buildProblemBank, fetchLeetCodeQuestions } from '../src/integrations/problem-bank.js';
import { contestRatings } from '../src/server/topics/ratings.js';

runCli(async () => {
  const options = args({ 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' } });
  if (Boolean(options['dry-run']) === Boolean(options.apply))
    throw Error('Choose exactly one of --dry-run or --apply.');
  if (options['dry-run']) {
    const questions = await fetchLeetCodeQuestions();
    const bank = buildProblemBank(questions, contestRatings(), new Date().toISOString());
    printJson({
      dryRun: true,
      fetched: questions.length,
      method: bank.model.method,
      estimated: bank.estimates.length,
      bankProblems: bank.payload.problems.length,
    });
    return;
  }
  const api = new LocalApi();
  await api.request('POST', '/api/problem-bank/refresh', {});
  for (;;) {
    const status = (await api.request('GET', '/api/problem-bank')) as { state: string };
    if (status.state !== 'running') {
      printJson(status);
      if (status.state === 'failed') process.exitCode = 1;
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
});
