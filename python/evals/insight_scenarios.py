"""Synthetic study records only. Expected behavior is a human review rubric."""
def scenario(name, entries, expected, corrected=False):
    observations, attempts = [], {}
    for i, (problem, note, polarity) in enumerate(entries):
        id = f'{name}-a{i}'
        attempts[id] = dict(id=id, status='completed', language='python', studyDate=f'2026-09-{i+1:02}',
            help='small' if polarity == 'difficulty' else 'none', outcome='solved', evidence='retention',
            code='', notes=note, takeaway='')
        observations.append(dict(id=f'{name}-o{i}', attemptId=id, problemId=problem,
            problemTitle=problem, studyDate=attempts[id]['studyDate'], help=attempts[id]['help'],
            evidence='retention', outcome='solved', summary=note, polarity=polarity,
            evidenceType='learner_reported', sourceField='notes', excerpt=note))
    # A dismissed diagnosis is absent from the current observation corpus.
    if corrected:
        observations = [o for o in observations if o['polarity'] == 'strength']
    return dict(name=name, expected=expected, attempts=attempts, context=dict(
        evidence=observations, questions=[], total=len(attempts), analyzed=len(attempts),
        observationCount=len(observations), retrievedCount=len(observations),
        limitations=['Synthetic reviewed scenario; no code execution or complete history.']))


SCENARIOS = [
    scenario('sparse', [], 'No diagnosis or invented records; an empty report is appropriate.'),
    scenario('repeated_problem', [
        ('Binary Search', 'I was unsure whether right should be mid or mid minus one.', 'difficulty'),
        ('Binary Search', 'Again needed a hint to decide whether mid remains a possible answer.', 'difficulty')],
        'Single-problem difficulty, not a recurring cross-problem issue; a bounds decision exercise.'),
    scenario('recurring', [
        ('Binary Search', 'I forgot to ensure the interval shrinks when only two elements remain.', 'difficulty'),
        ('Search Insert Position', 'My bounds stopped changing on two elements; I needed help with termination.', 'difficulty')],
        'May identify recurring termination trouble; propose a two-element trace with a shrinking-interval check.'),
    scenario('contradictory_strength', [
        ('Binary Search', 'I could not explain why mid stays inside the interval.', 'difficulty'),
        ('Search Insert Position', 'I independently explained the invariant and traced both update branches.', 'strength')],
        'Acknowledge the strength; do not generalise a weakness or claim comparable improvement.'),
    scenario('ambiguous_help', [
        ('Binary Search', 'I used a hint but did not record what it helped with.', 'difficulty')],
        'Do not infer an off-by-one error, invariant misconception or other specific cause.'),
    scenario('corrected', [
        ('Binary Search', 'I cannot explain search boundaries.', 'difficulty'),
        ('Binary Search', 'Correction: I explained the search bounds independently; my earlier note referred to syntax.', 'strength')],
        'Do not repeat the dismissed boundaries diagnosis; preserve the correction.', corrected=True),
]
