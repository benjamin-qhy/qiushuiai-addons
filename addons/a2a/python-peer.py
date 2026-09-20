"""Independent A2A Python SDK 1.1.2 client; disposable test endpoints only."""
import asyncio
import os
import sys
import httpx
from google.protobuf.json_format import ParseDict
from a2a.client import A2ACardResolver
from a2a.client.transports.jsonrpc import JsonRpcTransport
from a2a.types import SendMessageRequest, GetTaskRequest, CancelTaskRequest, SubscribeToTaskRequest, TaskState

async def main():
    base = sys.argv[1]
    if os.environ.get('QIUSHUIAI_E2E_DISPOSABLE') != '1' or not base.startswith('http://127.0.0.1:'):
        raise RuntimeError('Explicit disposable loopback required')
    async with httpx.AsyncClient(headers={'Authorization': 'Bearer independent-python-fixture-token', 'A2A-Version': '1.0'}, timeout=10) as http:
        card = await A2ACardResolver(http, base, '/api/addons/a2a/agents/echo/agent-card.json').get_agent_card()
        # Fixture card preserves HTTPS production origin; actual test transport is explicit loopback.
        client = JsonRpcTransport(http, card, base + '/api/addons/a2a/agents/echo/rpc')
        req = ParseDict({'message': {'messageId': 'python-1', 'role': 'ROLE_USER', 'parts': [{'text': 'Python SDK request'}]}, 'configuration': {'returnImmediately': True}}, SendMessageRequest())
        response = await client.send_message(req)
        task = response.task
        assert task.id and task.status.state == TaskState.TASK_STATE_WORKING
        duplicate = await client.send_message(req)
        assert duplicate.task.id == task.id
        queried = await client.get_task(GetTaskRequest(id=task.id, history_length=0))
        assert queried.id == task.id and len(queried.history) == 0
        cancelled = await client.cancel_task(CancelTaskRequest(id=task.id))
        assert cancelled.status.state == TaskState.TASK_STATE_CANCELED
        stream_request = ParseDict({'message': {'messageId': 'python-stream', 'role': 'ROLE_USER', 'parts': [{'text': 'complete-stream'}]}}, SendMessageRequest())
        events = [event async for event in client.send_message_streaming(stream_request)]
        assert events[0].HasField('task')
        assert events[-1].status_update.status.state == TaskState.TASK_STATE_COMPLETED
        print('PYTHON-A2A-PASS version=1.1.2 discovery send dedup get cancel stream')

asyncio.run(main())
