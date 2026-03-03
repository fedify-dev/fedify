# Lookup Command Tests Documentation

## Config Binding and Parsing Tests (8 tests)

### Test 1: Config lookup section binds into command defaults when no CLI flags provided

- **Title**: Config lookup section binds into command defaults when no CLI flags provided
- **Do**: Parse a minimal lookup invocation with config.lookup populated and no overriding flags.
- **Details**: Verify bound defaults for timeout/format/separator/traverse/suppressErrors/authorizedFetch-related defaults match config.

### Test 2: Config lookup value constraints reject invalid timeout/format inputs deterministically

- **Title**: Config lookup value constraints reject invalid timeout/format inputs deterministically
- **Do**: Attempt to bind/parse config.lookup containing an invalid value (e.g., non-positive or non-numeric timeout, unsupported format token).
- **Details**: Assert a clear validation error is produced (type/message stable enough for snapshot/substring match).

### Test 3: lookup options parse: timeout/format/separator/traverse/suppress-errors via expected flags

- **Title**: lookup options parse: timeout/format/separator/traverse/suppress-errors via expected flags
- **Do**: Parse argv including representative flags (e.g., --timeout, --separator, --traverse, --suppress-errors, --format variant) and one URL.
- **Details**: Use at least one short alias and one long flag to confirm alias equivalence.

### Test 4: authorized fetch dependency: --first-knock requires -a/--authorized-fetch

- **Title**: authorized fetch dependency: --first-knock requires -a/--authorized-fetch
- **Do**: Parse argv containing --first-knock without enabling authorized fetch.
- **Details**: Assert parsing/validation fails and the error indicates the missing dependency on authorized fetch.

### Test 5: lookupCommand parses URL arguments and preserves order

- **Title**: lookupCommand parses URL arguments and preserves order
- **Do**: Parse argv with multiple URL operands (no execution) and capture the resulting urls list.
- **Details**: Assert URL list length/order matches argv operand order; ensure no implicit normalization beyond URL parsing.

### Test 6: CLI flags override config-bound lookup defaults

- **Title**: CLI flags override config-bound lookup defaults
- **Do**: Bind config.lookup defaults, then parse argv specifying overriding flags (e.g., timeout/format/separator/traverse).
- **Details**: Assert each overridden field reflects argv rather than config (include at least timeout and format).

### Test 7: authorized fetch dependency: --tunnel-service requires -a/--authorized-fetch

- **Title**: authorized fetch dependency: --tunnel-service requires -a/--authorized-fetch
- **Do**: Parse argv containing --tunnel-service without enabling authorized fetch.
- **Details**: Assert deterministic validation failure and that the message mentions authorized fetch requirement.

### Test 8: Shared options parsing remains consistent for lookup (aliases and types)

- **Title**: Shared options parsing remains consistent for lookup (aliases and types)
- **Do**: Parse lookup-related options through the shared options layer (where applicable) using both short and long forms.
- **Details**: Focus on type coercion (number/bool/string) and alias equivalence as exposed to lookupCommand.

---

## Timeout Signal with Fake Timers (2 tests)

### Test 9: createTimeoutSignal aborts only after the configured timeout with TimeoutError reason

- **Title**: createTimeoutSignal aborts only after the configured timeout with TimeoutError reason
- **Do**: Create a timeout signal with a short ms, advance time to just-before and then just-after the deadline, observing signal state and reason.
- **Details**: Validate signal.aborted flips only after the threshold; verify abort reason surfaces TimeoutError identity (name/message).

### Test 10: clearTimeoutSignal cancels the timer so the signal never aborts

- **Title**: clearTimeoutSignal cancels the timer so the signal never aborts
- **Do**: Create a timeout signal, immediately clearTimeoutSignal(signal), then advance time beyond the original timeout and check signal is still not aborted.
- **Details**: Also assert timer cancellation path is exercised (clearTimeout invoked for the created timer).

---

## Additional Parsing Tests (3 tests)

### Test 11: lookupCommand requires at least one URL

- **Title**: lookupCommand requires at least one URL
- **Do**: Parse lookup command without any URL arguments.
- **Details**: Assert parsing fails with validation error indicating missing required URL operand.

### Test 12: lookupCommand parses timeout as float

- **Title**: lookupCommand parses timeout as float
- **Do**: Parse lookup command with timeout specified as decimal number (e.g., 3.5).
- **Details**: Assert timeout is parsed as floating-point number and type is preserved.

### Test 13: lookupCommand combines multiple flags correctly

- **Title**: lookupCommand combines multiple flags correctly
- **Do**: Parse lookup command with multiple short flags combined (traverse, suppress-errors, raw format, timeout, separator).
- **Details**: Assert all flags are parsed correctly and multiple URLs are accepted in correct order.

---

## Core Timeout Logic Tests (5 tests)

### Test 14: TimeoutError has correct name and message

- **Title**: TimeoutError has correct name and message
- **Do**: Create TimeoutError instance and verify name property and message preservation.
- **Details**: Assert name is "TimeoutError", message matches constructor argument, and error is instanceof Error and TimeoutError.

### Test 15: TimeoutError is throwable and catchable

- **Title**: TimeoutError is throwable and catchable
- **Do**: Throw TimeoutError and catch it to verify error handling behavior.
- **Details**: Assert caught error is instanceof TimeoutError with correct name and message properties.

### Test 16: createTimeoutSignal with zero timeout creates immediate abort

- **Title**: createTimeoutSignal with zero timeout creates immediate abort
- **Do**: Call createTimeoutSignal with timeout = 0 and check if signal aborts immediately.
- **Details**: Assert signal becomes aborted after short delay with TimeoutError reason.

### Test 17: TimeoutError message contains timeout duration

- **Title**: TimeoutError message contains timeout duration
- **Do**: Create TimeoutError instances with different timeout durations in message.
- **Details**: Assert message strings contain the timeout values (10, 0.5) for debugging clarity.

### Test 18: Multiple timeout signals can be created independently

- **Title**: Multiple timeout signals can be created independently
- **Do**: Create multiple timeout signals with different timeout values.
- **Details**: Assert each signal is unique AbortSignal instance (no shared state between signals).

---

## DocumentLoader Integration Tests (8 tests)

### Test 19: Wrapped document loader succeeds when request completes before timeout

- **Title**: Wrapped document loader succeeds when request completes before timeout
- **Do**: Call wrapped document loader with 1-second timeout where request completes in 10ms.
- **Details**: Assert successful document retrieval with correct type and id when operation finishes before timeout.

### Test 20: Wrapped document loader aborts when request exceeds timeout

- **Title**: Wrapped document loader aborts when request exceeds timeout
- **Do**: Call wrapped loader with 50ms timeout where underlying request takes 200ms.
- **Details**: Assert request is aborted with timeout error before slow operation completes.

### Test 21: Wrapped document loader without timeout behaves like original

- **Title**: Wrapped document loader without timeout behaves like original
- **Do**: Wrap loader with undefined timeout parameter.
- **Details**: Assert wrapped loader functions identically to original loader (no timeout behavior injected).

### Test 22: Wrapped document loader propagates network errors

- **Title**: Wrapped document loader propagates network errors
- **Do**: Call wrapped loader where underlying loader throws network error.
- **Details**: Assert network errors pass through wrapper unchanged (not masked as timeout errors).

### Test 23: Document loader handles multiple concurrent requests with timeout

- **Title**: Document loader handles multiple concurrent requests with timeout
- **Do**: Execute 3 parallel requests through wrapped loader with timeout.
- **Details**: Assert all concurrent requests succeed independently without timeout interference or shared state issues.

### Test 24: Document loader timeout cleans up properly after abort

- **Title**: Document loader timeout cleans up properly after abort
- **Do**: Trigger timeout abort with 20ms timeout and 100ms slow request.
- **Details**: Assert timeout cleanup (clearTimeoutSignal) executes properly preventing timer leaks after abort.

### Test 25: Document loader handles AbortSignal passed from outside

- **Title**: Document loader handles AbortSignal passed from outside
- **Do**: Create manually aborted AbortController and pass its signal to mock loader.
- **Details**: Assert externally aborted signal causes loader to reject with abort error.

### Test 26: Document loader respects zero timeout as immediate abort

- **Title**: Document loader respects zero timeout as immediate abort
- **Do**: Wrap loader with timeout = 0 to trigger immediate abort behavior.
- **Details**: Assert zero timeout causes immediate rejection (useful for testing abort paths).

---

Made with Ogoron AI
