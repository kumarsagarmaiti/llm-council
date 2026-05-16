export const SYSTEM_INFO_POLL_MS = 15000;

export function shouldPollSystemInfo(documentState = 'visible') {
  return documentState === 'visible';
}
