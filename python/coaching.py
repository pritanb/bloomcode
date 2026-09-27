"""Route on-demand coaching without replacing ordinary Codex conversations."""
import json
import re
from uuid import uuid4
from coaching_model import Route, ROUTING
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
        elif action == 'retry': self.graph.retry()
        elif action == 'clear':
            self.graph.clear()
            self.candidates = []
        else: raise ValueError('Unknown coaching action')
        self.save_routing()

    def reply(self, message, request_id=None, context_id=None, on_activity=None):
        self.notice = None
        self.save_routing()
        request = {'id': request_id or str(uuid4()), 'message': message}
        self.evidence.check_access()
        current = self.graph.state()
        if current and request['id'] in current.get('receipts', {}):
            result = self.graph.reply(request)
            return result['receipts'][request['id']]['response']
        view = self.view()
        if on_activity: on_activity('Choosing the right kind of help…')
        route = self.model(Route, ROUTING, {
            'message': message, 'context_attempt_id': context_id,
            'coaching': view, 'candidate_attempts': self.candidates})
        allowed_ids = set(re.findall(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', message))
        allowed_ids.update(c['id'] for c in self.candidates)
        if context_id: allowed_ids.add(context_id)
        if view: allowed_ids.add(view['attemptId'])
        if route.attempt_id and route.attempt_id not in allowed_ids:
            raise RuntimeError('Could not safely identify the attempt. Specify its problem name or use the completed-attempt screen.')
        if route.intent in ('chat', 'leave'):
            self.graph.pause()
            if route.intent == 'leave':
                self.notice = 'Coaching is paused. You can resume it whenever you want.'
                self.save_routing()
                return self.notice
            return None
        if route.intent == 'resume' and view:
            self.graph.resume()
            return (view['messages'][-1]['text'] if view['messages'] else
                    'The coaching step was interrupted. Choose Retry step to continue.')
        if route.intent == 'answer' and view and view['status'] != 'completed':
            if on_activity: on_activity('Checking your answer against the evidence…')
            result = self.graph.reply(request)
            return result['messages'][-1]['text']
        if on_activity: on_activity('Finding the completed attempt…')
        id, candidates = self.evidence.resolve(route, context_id)
        if not id:
            self.candidates = candidates
            self.notice = ('Which attempt would you like to review?\n' + '\n'.join(
                f"{c['title']} — {c['date']} ({c['id']})" for c in candidates)
                if candidates else 'I could not find a completed attempt. Tell me the problem name after completing practice.')
            self.save_routing()
            return self.notice
        self.candidates = []
        self.save_routing()
        if on_activity: on_activity('Preparing a question from your recorded attempt…')
        result = self.graph.start(id, request)
        return result['messages'][-1]['text']
