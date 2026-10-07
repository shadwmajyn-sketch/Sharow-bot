import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sendMessage } from "../lib/messenger.js";

export const BASE_INTERVALS_SECONDS = Object.freeze([15, 19, 29, 34]);
const SEND_RETRY_COUNT = 2;
const transientFailure =
  /(timeout|timed out|temporary|network|socket|econn|503|502)/i;

export function normalizeBaseText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBaseControl(value) {
  return normalizeBaseText(value).toLocaleLowerCase("ar");
}

export function parseBaseAction(value) {
  const text = normalizeBaseText(value);
  const control = normalizeBaseControl(text);
  if (["إيقاف", "ايقاف", "وقف", "stop"].includes(control)) {
    return { type: "stop" };
  }
  if (["حالة", "status"].includes(control)) return { type: "status" };
  if (!text) return { type: "empty" };
  return { type: "start", text };
}

export function chooseBaseInterval(randomValue = Math.random()) {
  const value = Math.min(Math.max(Number(randomValue) || 0, 0), 0.999999999);
  const index = Math.floor(value * BASE_INTERVALS_SECONDS.length);
  return BASE_INTERVALS_SECONDS[index];
}

export function isTransientBaseFailure(error) {
  const message =
    typeof error?.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    transientFailure.test(message) ||
    /^E(?:CONN|PIPE|HOST|TIMEDOUT)/i.test(String(error?.code ?? ""))
  );
}

export function makeLoopStatus(loop) {
  if (!loop) return null;
  return {
    sent: loop.sent,
    failures: loop.failures,
    nextSeconds: loop.nextSeconds,
    active: !loop.stopped,
    text: loop.text,
  };
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendWithRetry(api, text, threadId) {
  let lastError;
  for (let attempt = 1; attempt <= SEND_RETRY_COUNT; attempt += 1) {
    try {
      await sendMessage(api, text, threadId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === SEND_RETRY_COUNT || !isTransientBaseFailure(error)) {
        throw error;
      }
      await pause(1000 * attempt);
    }
  }
  throw lastError ?? new Error("Message send failed.");
}

function ensureLoopMap(runtime, propertyName = "baseLoops") {
  if (!(runtime[propertyName] instanceof Map)) runtime[propertyName] = new Map();
  return runtime[propertyName];
}

function clearLoopTimer(loop) {
  if (!loop.timer) return;
  clearTimeout(loop.timer);
  loop.timer = null;
}

function stopLoop(runtime, threadId, propertyName = "baseLoops") {
  const loops = ensureLoopMap(runtime, propertyName);
  const loop = loops.get(threadId);
  if (!loop) return false;
  loop.stopped = true;
  loop.stoppedAt = Date.now();
  clearLoopTimer(loop);
  loops.delete(threadId);
  return true;
}

function scheduleNextSend(runtime, threadId, loop, send, options) {
  if (loop.stopped) return;
  const loops = ensureLoopMap(runtime, options.propertyName);
  if (loops.get(threadId) !== loop) return;

  const nextSeconds = options.intervalSeconds ?? chooseBaseInterval();
  loop.nextSeconds = nextSeconds;
  loop.scheduledAt = Date.now();
  loop.timer = setTimeout(async () => {
    loop.timer = null;
    if (loop.stopped || loops.get(threadId) !== loop) return;

    loop.inFlight = true;
    try {
      await sendWithRetry(runtime.api, loop.text, threadId);
      loop.sent += 1;
      loop.lastSentAt = Date.now();
      loop.failures = 0;
    } catch (error) {
      loop.failures += 1;
      loop.stopped = true;
      loop.stoppedAt = Date.now();
      loops.delete(threadId);
      try {
        await send(
          isTransientBaseFailure(error)
            ? "توقف التكرار بعد تعذر الاتصال أكثر من مرة."
            : "توقف التكرار لأن Messenger رفض إرسال النص.",
        );
      } catch {
        // The loop is already stopped; a failed notice must not revive it.
      }
    } finally {
      loop.inFlight = false;
    }

    if (!loop.stopped && loops.get(threadId) === loop) {
      scheduleNextSend(runtime, threadId, loop, send, options);
    }
  }, nextSeconds * 1000);
}

export function stopBaseLoop(runtime, threadId) {
  return stopLoop(runtime, String(threadId));
}

export function stopDevilLoop(runtime, threadId) {
  return stopLoop(runtime, String(threadId), "devilLoops");
}

export function getBaseLoopStatus(runtime, threadId) {
  const loops = ensureLoopMap(runtime);
  return makeLoopStatus(loops.get(String(threadId)) ?? null);
}

export function getDevilLoopStatus(runtime, threadId) {
  const loops = ensureLoopMap(runtime, "devilLoops");
  return makeLoopStatus(loops.get(String(threadId)) ?? null);
}

export function describeBaseStatus(status) {
  if (!status?.active) return "لا يوجد تكرار نشط في هذه المجموعة.";
  return `التكرار نشط؛ أُرسلت ${status.sent} رسالة. الموعد التالي بعد ${status.nextSeconds} ثانية.`;
}

export function describeBaseStarted(prefix) {
  return `بدأ التكرار. الفاصل عشوائي: 15 أو 19 أو 29 أو 34 ثانية. للإيقاف: ${prefix}بيس إيقاف`;
}

function describeRepeatStarted(prefix, commandName, intervalSeconds) {
  if (intervalSeconds) {
    return `بدأ ${commandName}. الفاصل ثابت: ${intervalSeconds} ثانية. للإيقاف: ${prefix}${commandName} إيقاف`;
  }
  return describeBaseStarted(prefix);
}

async function startRepeatLoop({
  runtime,
  threadId,
  text,
  send,
  prefix,
  commandName,
  propertyName,
  intervalSeconds,
}) {
  const loops = ensureLoopMap(runtime, propertyName);
  if (loops.has(threadId)) {
    await send(
      `يوجد تكرار ${commandName} نشط بالفعل. أوقفه أولًا باستخدام «${commandName} إيقاف».`,
    );
    return false;
  }

  const loop = {
    text,
    stopped: false,
    sent: 0,
    failures: 0,
    timer: null,
    inFlight: false,
    createdAt: Date.now(),
    lastSentAt: null,
    scheduledAt: null,
    stoppedAt: null,
    nextSeconds: null,
  };
  loops.set(threadId, loop);
  const options = { propertyName, intervalSeconds };
  scheduleNextSend(runtime, threadId, loop, send, options);

  try {
    await send(describeRepeatStarted(prefix, commandName, intervalSeconds));
  } catch (error) {
    stopLoop(runtime, threadId, propertyName);
    throw error;
  }
  return true;
}

export function createRepeatCommand({
  name,
  aliases = [],
  propertyName,
  intervalSeconds = null,
}) {
  return {
    name,
    aliases,
    description: intervalSeconds
      ? `تكرار نص بفاصل ثابت ${intervalSeconds} ثانية`
      : "تكرار نص، عرض الحالة، أو إيقافه",
    async execute({ args, send, threadId, runtime, state }) {
      const action = parseBaseAction(args);
      const id = String(threadId);

      if (action.type === "empty") {
        await send(
          `اكتب النص بعد الأمر، أو استخدم «${name} حالة» أو «${name} إيقاف».`,
        );
        return;
      }
      if (action.type === "stop") {
        await send(
          stopLoop(runtime, id, propertyName)
            ? `تم إيقاف تكرار ${name} في هذه المجموعة.`
            : `لا يوجد تكرار ${name} نشط في هذه المجموعة.`,
        );
        return;
      }
      if (action.type === "status") {
        await send(
          describeBaseStatus(
            makeLoopStatus(ensureLoopMap(runtime, propertyName).get(id) ?? null),
          ),
        );
        return;
      }

      await startRepeatLoop({
        runtime,
        threadId: id,
        text: action.text,
        send,
        prefix: state.getPrefix(id),
        commandName: name,
        propertyName,
        intervalSeconds,
      });
    },
  };
}

const command = createRepeatCommand({
  name: "بيس",
  aliases: ["base"],
  propertyName: "baseLoops",
});

export default command;

export function runBaseCommandSelfTests() {
  assert.deepEqual(parseBaseAction(""), { type: "empty" });
  assert.deepEqual(parseBaseAction("إيقاف"), { type: "stop" });
  assert.deepEqual(parseBaseAction("ايقاف"), { type: "stop" });
  assert.deepEqual(parseBaseAction("STOP"), { type: "stop" });
  assert.deepEqual(parseBaseAction("حالة"), { type: "status" });
  assert.deepEqual(parseBaseAction("status"), { type: "status" });
  assert.deepEqual(parseBaseAction("  hello there  "), {
    type: "start",
    text: "hello there",
  });

  assert.equal(chooseBaseInterval(0), 15);
  assert.equal(chooseBaseInterval(0.25), 19);
  assert.equal(chooseBaseInterval(0.5), 29);
  assert.equal(chooseBaseInterval(0.75), 34);
  assert.ok(BASE_INTERVALS_SECONDS.includes(chooseBaseInterval(1)));
  assert.equal(isTransientBaseFailure(new Error("network timeout")), true);
  assert.equal(isTransientBaseFailure(new Error("policy denied")), false);
  assert.equal(isTransientBaseFailure({ code: "ECONNRESET" }), true);

  assert.equal(makeLoopStatus(null), null);
  assert.deepEqual(
    makeLoopStatus({
      stopped: false,
      sent: 2,
      failures: 0,
      nextSeconds: 19,
      text: "hello",
    }),
    {
      sent: 2,
      failures: 0,
      nextSeconds: 19,
      active: true,
      text: "hello",
    },
  );
  assert.equal(
    describeBaseStatus(null),
    "لا يوجد تكرار نشط في هذه المجموعة.",
  );
  assert.equal(
    describeBaseStarted("#"),
    "بدأ التكرار. الفاصل عشوائي: 15 أو 19 أو 29 أو 34 ثانية. للإيقاف: #بيس إيقاف",
  );
  const devilCommand = createRepeatCommand({
    name: "devil",
    propertyName: "devilLoops",
    intervalSeconds: 60,
  });
  assert.equal(devilCommand.name, "devil");
  assert.match(devilCommand.description, /60 ثانية/);

  const longText = "م".repeat(100_000);
  assert.deepEqual(parseBaseAction(longText), {
    type: "start",
    text: longText,
  });
  const runtime = {
    baseLoops: new Map([
      ["thread", { stopped: false, sent: 0, failures: 0, nextSeconds: 15, text: "x" }],
    ]),
  };
  assert.equal(getBaseLoopStatus(runtime, "thread").active, true);
  assert.equal(getBaseLoopStatus(runtime, "missing"), null);
}

if (
  process.argv.includes("--self-test") &&
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  runBaseCommandSelfTests();
  process.stdout.write("base command self-tests passed\n");
}
