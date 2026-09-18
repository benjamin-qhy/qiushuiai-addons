"""Independent protobuf-descriptor/RFC8785/Ed25519 verification, test only.
Dependencies: a2a-sdk==1.1.2, rfc8785==0.1.4, cryptography (peer test env).
No network; test JWK and card arrive on stdin and are never logged.
"""
import sys, json, base64
import rfc8785
from a2a.types import AgentCard
from google.api import field_behavior_pb2 as behavior
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

def decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))

def normalise(raw, descriptor):
    out = {}
    for field in descriptor.fields:
        name = field.json_name
        if descriptor.full_name.endswith('.AgentCard') and name == 'signatures':
            continue
        required = behavior.REQUIRED in field.GetOptions().Extensions[behavior.field_behavior]
        present = name in raw and raw[name] is not None
        if not present and not required:
            continue
        repeated = field.is_repeated
        is_map = field.message_type and field.message_type.GetOptions().map_entry
        value = raw.get(name)
        if value is None:
            value = {} if is_map or field.message_type and not repeated else [] if repeated else False if field.type == field.TYPE_BOOL else ''
        def sub(v, message):
            if not message or message.full_name == 'google.protobuf.Struct': return v
            return normalise(v, message)
        if is_map:
            normal = {k:sub(v, field.message_type.fields_by_name['value'].message_type) for k,v in value.items()}
        elif repeated:
            normal = [sub(v, field.message_type) for v in value]
        else:
            normal = sub(value, field.message_type)
        if required or field.has_presence or normal not in ('', False, 0, None, [], {}):
            out[name] = normal
    return out

payload = json.load(sys.stdin)
card = payload['card']
canonical = rfc8785.dumps(normalise(card, AgentCard.DESCRIPTOR))
assert canonical.decode() == payload['canonical'], 'Independent canonical bytes differ'
signature = card['signatures'][0]
key = Ed25519PublicKey.from_public_bytes(decode(payload['key']['x']))
encoded = base64.urlsafe_b64encode(canonical).rstrip(b'=')
key.verify(decode(signature['signature']), signature['protected'].encode() + b'.' + encoded)
print('INDEPENDENT-PROTOBUF-JCS-ED25519-PASS')
