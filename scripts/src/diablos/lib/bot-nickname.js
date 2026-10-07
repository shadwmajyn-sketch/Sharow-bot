import { delay } from "./messenger.js";

export const BOT_NICKNAME_CHECK_DELAY_MS = 5_000;

function participantId(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const candidate =
      value.userID ?? value.userFbId ?? value.user_fb_id ?? value.uid ?? value.id;
    if (candidate !== undefined && candidate !== null) return String(candidate);
  }
  return null;
}

export async function ensureBotNickname(api, threadId, nickname) {
  const id = String(threadId ?? "").trim();
  const botId = String(api.getCurrentUserID());
  const info = await api.getThreadInfo(id);
  const participantIds = (info?.participantIDs ?? [])
    .map(participantId)
    .filter(Boolean);

  if (!participantIds.includes(botId)) {
    return { present: false, changed: false };
  }

  if ((info?.nicknames?.[botId] ?? "") === nickname) {
    return { present: true, changed: false };
  }

  await api.nickname(nickname, id, botId);
  const verifiedInfo = await api.getThreadInfo(id);
  if ((verifiedInfo?.nicknames?.[botId] ?? "") !== nickname) {
    throw new Error("The updated nickname was not confirmed.");
  }
  return { present: true, changed: true };
}

export function createBotNicknameGuard(
  api,
  nickname,
  onError = () => {},
  checkDelayMs = BOT_NICKNAME_CHECK_DELAY_MS,
) {
  const timers = new Map();
  const running = new Set();
  const pending = new Set();

  async function check(threadId) {
    const id = String(threadId);
    if (running.has(id)) {
      pending.add(id);
      return;
    }
    running.add(id);
    try {
      const result = await ensureBotNickname(api, id, nickname);
      if (result.changed) onError(`Restored the bot nickname in group ${id}.`);
    } catch {
      onError(`Could not verify or restore the bot nickname in group ${id}.`);
    } finally {
      running.delete(id);
      if (pending.delete(id)) schedule(id);
    }
  }

  function schedule(threadId) {
    const id = String(threadId ?? "").trim();
    if (!id) return false;
    if (running.has(id)) {
      pending.add(id);
      return true;
    }
    const existingTimer = timers.get(id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      timers.delete(id);
      void check(id);
    }, checkDelayMs);
    timers.set(id, timer);
    return true;
  }

  function stop() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    pending.clear();
  }

  return { schedule, stop };
}

