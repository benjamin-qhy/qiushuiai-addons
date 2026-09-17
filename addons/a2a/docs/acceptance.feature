@initiative-a2a @disposable
Feature: Opt-in A2A v1 interoperability
  # Acceptance prose mapped to executable Bun tests, not unimplemented step bindings.
  # core operation foundation: rcarmo/piclaw#1335 and #1336

  @a2a-001
  Scenario: Disabled startup and missing runtime capabilities deny execution
    Given no compatible host operation API or no operator enablement
    When the add-on loads or receives a request
    Then it neither calls a provider nor admits external work
    And status explains the disabled or missing capability
    # service.test.ts, index.test.ts

  @a2a-002
  Scenario: Authenticate and authorise before task access
    Given an explicitly configured bearer principal and published target
    When another principal or a browser cookie requests a task
    Then access is denied without disclosing task data
    And revoked grants block new task and stream access
    # security.test.ts, server.test.ts, handler.test.ts

  @a2a-003
  Scenario: Preserve protocol identities across retries and restarts
    When an identical message is retried in the same principal namespace
    Then its existing task and core operation are reused
    And a conflicting payload fails
    And unknown send or continuation outcomes are never blindly replayed
    # task-store.test.ts, client.test.ts, host-integration.test.ts

  @a2a-004
  Scenario: Stream and cancel without coupling execution to the HTTP consumer
    Given a durable running operation
    When a streaming consumer disconnects or shutdown begins
    Then its transport resources are released
    And durable execution is not falsely marked cancelled
    When an owned task cancellation is requested
    Then the response reflects the confirmed core outcome
    # server.test.ts, handler.test.ts, core operation-lifecycle tests

  @a2a-005
  Scenario: Exchange supported text data and artifacts safely
    When a message contains text, structured JSON or a bounded UTF8 inline file
    Then the content is validated and treated as untrusted data
    And URL fetching, binary formats and traversal filenames are rejected
    And incremental artifacts respect append and final-chunk bounds
    # parts.test.ts, task-store.test.ts

  @a2a-006
  Scenario: Independent implementations exchange v1 wire messages
    When the outbound client calls a hand-written v1 peer
    And the independent Python SDK calls the inbound server
    Then discovery, send, get, cancel and SSE complete with valid v1 fields
    And unsupported versions and capabilities return explicit errors
    # client.test.ts, python-peer.test.ts, sdk-http.test.ts

  @a2a-007
  Scenario: Operator settings require reviewed enablement
    When an operator configures credentials, agents and endpoints
    Then only keychain references are stored
    And enablement requires explicit review confirmation
    And immediate disable stops transport consumers
    And both skins fit desktop and mobile widths
    # settings-browser.test.ts, service.test.ts
