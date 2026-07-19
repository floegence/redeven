export const terminalHistoryMaxBytes = 8 * 1024 * 1024;
export const terminalHistoryChunkMaxBytes = 32 * 1024;

export function minimumRetainedBytesForFixture(fixtureBytes) {
  if (fixtureBytes >= terminalHistoryMaxBytes) {
    return terminalHistoryMaxBytes - terminalHistoryChunkMaxBytes;
  }
  return fixtureBytes;
}

export function historyFixtureDriftIsValid(fixtureBytes, seededBytes, recoveredBytes) {
  const drift = recoveredBytes - seededBytes;
  if (fixtureBytes >= terminalHistoryMaxBytes) {
    return Math.abs(drift) <= terminalHistoryChunkMaxBytes;
  }
  return drift >= 0 && drift <= terminalHistoryChunkMaxBytes;
}
