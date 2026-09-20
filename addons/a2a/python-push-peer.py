"""Independent Python SDK/raw-webhook fixture. No production endpoints/credentials."""
import asyncio, json, os, sys
import httpx
from google.protobuf.json_format import ParseDict
from a2a.client import A2ACardResolver
from a2a.client.transports.jsonrpc import JsonRpcTransport
from a2a.types import (SendMessageRequest, TaskPushNotificationConfig, GetTaskPushNotificationConfigRequest,
                      ListTaskPushNotificationConfigsRequest, DeleteTaskPushNotificationConfigRequest)

async def main():
    base, callback = sys.argv[1:]
    if os.environ.get('QIUSHUIAI_E2E_DISPOSABLE') != '1' or not base.startswith('http://127.0.0.1:') or not callback.startswith('http://127.0.0.1:'):
        raise RuntimeError('Disposable loopback fixtures required')
    async with httpx.AsyncClient(headers={'Authorization':'Bearer python-inbound-fixture-key-long','A2A-Version':'1.0'},timeout=15) as http:
        card = await A2ACardResolver(http,base,'/api/addons/a2a/agents/echo/agent-card.json').get_agent_card()
        assert card.capabilities.push_notifications
        client = JsonRpcTransport(http,card,base+'/api/addons/a2a/agents/echo/rpc')
        sent = await client.send_message(ParseDict({'message':{'messageId':'python-push','role':'ROLE_USER','parts':[{'text':'work'}]},'configuration':{'returnImmediately':True}},SendMessageRequest()))
        task_id=sent.task.id
        config=await client.create_task_push_notification_config(ParseDict({'id':'python-callback','taskId':task_id,'url':callback+'/notify','authentication':{'scheme':'Bearer','credentials':'python-callback-fixture-key-long'}},TaskPushNotificationConfig()))
        assert config.id == 'python-callback' and not config.authentication.credentials
        fetched=await client.get_task_push_notification_config(GetTaskPushNotificationConfigRequest(task_id=task_id,id=config.id))
        assert fetched.url == callback+'/notify'
        listed=await client.list_task_push_notification_configs(ListTaskPushNotificationConfigsRequest(task_id=task_id,page_size=1))
        assert len(listed.configs)==1
        # Trigger test executor completion; no A2A task polling follows.
        await http.post(base+'/fixture/complete')
        notifications=[]
        for _ in range(100):
            notifications=(await http.get(callback+'/seen')).json()
            if any(n['payload'].get('statusUpdate',{}).get('status',{}).get('state')=='TASK_STATE_COMPLETED' for n in notifications): break
            await asyncio.sleep(.05)
        assert any(n['payload'].get('statusUpdate',{}).get('status',{}).get('state')=='TASK_STATE_COMPLETED' for n in notifications)
        assert all(n['auth']=='Bearer python-callback-fixture-key-long' and n['type']=='application/a2a+json' for n in notifications)
        for n in notifications:
            p=n['payload']; variant=next(iter(p)); assert len(p)==1
            assert (p[variant]['id'] if variant=='task' else p[variant]['taskId']) == task_id
        await client.delete_task_push_notification_config(DeleteTaskPushNotificationConfigRequest(task_id=task_id,id=config.id))
        print('PYTHON-PUSH-PASS independent CRUD StreamResponse Bearer task-identity no-task-polling')

asyncio.run(main())
