"""Route on-demand coaching without replacing ordinary Codex conversations."""
import json
from uuid import uuid4
from coaching_evidence import Evidence
from coaching_graph import CoachingGraph


class Coaching:
    def __init__(self, root, model, config):
        self.model = model
        self.evidence = Evidence(config)
        self.graph = CoachingGraph(root, model, self.evidence)
        self.routing_file = root / 'coaching-routing.json'
        routing = json.loads(self.routing_file.read_text()) if self.routing_file.exists() else {}
        self.notice = routing.get('notice')
        self.candidates = routing.get('candidates', [])

    def close(self): self.graph.close()

    def save_routing(self):
        temp = self.routing_file.with_suffix('.tmp')
        temp.write_text(json.dumps({'notice': self.notice, 'candidates': self.candidates}))
        temp.replace(self.routing_file)

    def view(self):
        view = self.graph.view()
        if view: view['notice'] = self.notice
        return view

    def control(self, action):
        self.notice = None
        if action in ('resume', 'retry'):
            self.evidence.check_access()
        if action == 'pause': self.graph.pause()
        elif action == 'resume': self.graph.resume()
        elif action == 'retry':
            result = self.graph.retry()
            receipt = result.get('receipts', {}).get(result['request']['id'], {})
            if receipt.get('handoff'):
                self.graph.pause()
                self.notice = 'Coaching is paused. Send your request in ordinary chat to continue.'
        elif action == 'clear':
            self.graph.clear()
            self.candidates = []
        else: raise ValueError('Unknown coaching action')
        self.save_routing()

    def reply(self, message, request_id=None, context_id=None, on_activity=None, target=None):
        self.notice = None
        self.save_routing()
        # Explicit commands and the original starter phrase are convenience aliases.
        # Other free-form messages go straight to chat or the active teaching step.
        supplied_target = target
        text = message.strip()
        command, _, argument = text.partition(' ')
        if target is None:
            if command.lower() == '/coach':
                target = argument.strip() or 'latest'
            elif text.lower().rstrip('.') == 'coach me through my latest attempt':
                target = 'latest'
            elif any(c['id'] == text for c in self.candidates):
                target = text
        request = {'id': request_id or str(uuid4()), 'message': message,
                   'context_attempt_id': context_id, 'coaching_target': supplied_target}
        current = self.graph.state()
        view = self.view()
        receipt = None
        if current and request['id'] in current.get('receipts', {}):
            self.evidence.check_access()
            result = self.graph.reply(request)
            receipt = result['receipts'][request['id']]
        elif target is not None:
            self.evidence.check_access()
            return self.start(target, request, on_activity)
        elif view and view['status'] == 'active':
            self.evidence.check_access()
            if on_activity: on_activity('Preparing your next coaching response…')
            result = self.graph.reply(request)
            receipt = result['receipts'][request['id']]
        if receipt is None:
            # Ordinary replies must be visible even after a coaching session finishes.
            if view and view['status'] != 'paused':
                self.graph.pause()
            return None
        handoff = receipt.get('handoff')
        if not handoff:
            return receipt['response']
        self.graph.pause()
        if handoff == 'chat':
            return None
        self.notice = ('Coaching is paused. You can resume it whenever you want.'
                       if handoff == 'leave' else
                       'To switch attempts, use Coach this attempt on a completed-attempt screen, '
                       'or send /coach followed by a problem name or attempt ID.')
        self.save_routing()
        return self.notice

    def start(self, target, request, on_activity):
        if on_activity: on_activity('Finding the completed attempt…')
        id, candidates = self.evidence.resolve(target, request['context_attempt_id'])
        if not id:
            # Keep the old question available to resume while choosing a new attempt.
            self.graph.pause()
            self.candidates = candidates
            self.notice = ('Which attempt would you like to review? Send /coach followed by its ID.\n' + '\n'.join(
                f"{c['title']} — {c['date']} ({c['id']})" for c in candidates)
                if candidates else 'I could not find a completed attempt. Use /coach followed by a problem name after completing practice.')
            self.save_routing()
            return self.notice
        self.candidates = []
        self.save_routing()
        if on_activity: on_activity('Preparing a question from your recorded attempt…')
        result = self.graph.start(id, request)
        receipt = result['receipts'][request['id']]
        if receipt.get('handoff'):
            self.graph.pause()
            return None
        return receipt['response']
