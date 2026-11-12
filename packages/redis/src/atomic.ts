// Private implementation constants, also used by the adapter tests.
export const atomicRedisVersions = ["7.2.17", "7.4.12", "8.10.3"] as const;
export const atomicMaxEntries = 128;
export const atomicMaxBytes = 1024 * 1024;
export const atomicMaxTtlSeconds = 2 ** 31 - 1;

const versionNumbers = atomicRedisVersions.map((version) =>
  version.split(".").reduce((number, part) => number * 256 + Number(part), 0),
);
const versionCheck = `local version = redis.REDIS_VERSION_NUM
if ${versionNumbers.map((version) => `version ~= ${version}`).join(" and ")} then
  return redis.error_reply('ERR atomic KV batches require official Redis ${atomicRedisVersions.slice(0, -1).join(", ")}, or ${atomicRedisVersions.at(-1)}')
end
`;

// The complete scripts must stay below Redis's per-invocation 100,000 Lua
// instruction hook. Otherwise slow-script event handling can change Cluster
// topology between writes. Audited Lua 5.1 listings have 190/37 instructions,
// no Lua functions, and only separate loops over at most 128 keys: each static
// instruction runs at most 129 times (24,510/4,773 total). Native command paths
// are synchronous on the exact releases above. Re-audit these bounds and the
// engine internals when changing a script, limit, or supported release.
// See Redis src/script_lua.c luaCallFunction(), deps/lua/src/ldebug.c
// lua_sethook(), src/script.c scriptVerifyClusterState(), and src/cluster.c
// getNodeByQuery(). Debugger execution, module hooks, and modified engines are
// outside this guarantee. All keys must be declared in KEYS; never split calls.

export const atomicMutationScript = `#!lua
${versionCheck}-- Fixed shape ARGV: CAS flag, then five arguments/key:
-- absence flag, expected bytes, deletion flag, replacement bytes, TTL seconds.
if #KEYS > ${atomicMaxEntries} then return redis.error_reply('ERR batch too large') end
if #ARGV ~= 1 + 5 * #KEYS then
  return redis.error_reply('ERR invalid atomic KV arguments')
end
local seen = {}
local current = {}
local matches = true
for i, key in ipairs(KEYS) do
  if seen[key] then return redis.error_reply('ERR duplicate atomic KV key') end
  seen[key] = true
  local base = 2 + (i - 1) * 5
  if ARGV[1] == '1' then
    current[i] = redis.call('GET', key)
    if ARGV[base] == '1' then
      if current[i] then matches = false end
    elseif not current[i] or current[i] ~= ARGV[base+1] then
      matches = false
    end
  else
    redis.call('EXISTS', key)
  end
  local permitted
  if ARGV[base+2] == '1' then
    permitted = redis.acl_check_cmd('DEL', key)
  elseif ARGV[base+4] == '0' then
    permitted = redis.acl_check_cmd('SET', key, ARGV[base+3])
  else
    permitted = redis.acl_check_cmd('SETEX', key, ARGV[base+4], ARGV[base+3])
  end
  if not permitted then return redis.error_reply('NOPERM atomic KV mutation denied') end
end
if not matches then return 0 end
for i, key in ipairs(KEYS) do
  local base = 2 + (i - 1) * 5
  if ARGV[base+2] == '1' then
    redis.call('DEL', key)
  elseif ARGV[base+4] == '0' then
    redis.call('SET', key, ARGV[base+3])
  else
    redis.call('SETEX', key, ARGV[base+4], ARGV[base+3])
  end
end
return 1
`;

export const atomicSnapshotScript = `#!lua flags=no-writes
${versionCheck}if #KEYS > ${atomicMaxEntries} then return redis.error_reply('ERR batch too large') end
local values = {}
for i, key in ipairs(KEYS) do
  values[i] = redis.call('GET', key)
end
return values
`;
