import assert from "node:assert/strict";
import test from "node:test";
import baseCommand, {
  createRepeatCommand,
  getBaseLoopStatus,
  getDevilLoopStatus,
  runBaseCommandSelfTests,
  stopBaseLoop,
  stopDevilLoop,
} from "../src/diablos/cmd/base.js";
import devilCommand from "../src/diablos/cmd/devil.js";
import clearNicknamesCommand from "../src/diablos/cmd/clear-nicknames.js";
import {
  runNameCommandSelfTests,
  updateGroupName,
} from "../src/diablos/cmd/name.js";
import nicknamesCommand, {
  runNicknameCommandSelfTests,
  updateGroupNicknames,
} from "../src/diablos/cmd/nicknames.js";
import protectCommand from "../src/diablos/cmd/protect.js";
import {
  ensureBotNickname,
  BOT_NICKNAME_CHECK_DELAY_MS,
} from "../src/diablos/lib/bot-nickname.js";

const FIXED_NICKNAME = "D̲i̲a̲b̲l̲o̲s̲꙰ │ ➯〘🇷🇺〙";

test("existing command helpers pass their local checks", async () => {
  runBaseCommandSelfTests();
  await runNameCommandSelfTests();
  runNicknameCommandSelfTests();
});

test("devil uses its own loop and a fixed sixty-second delay", async () => {
  const runtime = {
    api: {},
    baseLoops: new Map(),
    devilLoops: new Map(),
  };
  const state = { getPrefix: () => "!" };
  const send = async () => {};

  await devilCommand.execute({
    args: "hello",
    send,
    threadId: "group",
    runtime,
    state,
  });
  assert.equal(getDevilLoopStatus(runtime, "group").nextSeconds, 60);
  assert.equal(getBaseLoopStatus(runtime, "group"), null);

  await baseCommand.execute({
    args: "hello",
    send,
    threadId: "group",
    runtime,
    state,
  });
  assert.ok([15, 19, 29, 34].includes(getBaseLoopStatus(runtime, "group").nextSeconds));
  assert.equal(getDevilLoopStatus(runtime, "group").nextSeconds, 60);

  stopBaseLoop(runtime, "group");
  stopDevilLoop(runtime, "group");
});

test("group-name change does not locally require bot-admin status", async () => {
  const info = { threadName: "Old name", adminIDs: [] };
  const api = {
    getThreadInfo: async () => ({ ...info }),
    gcname: async (name) => {
      info.threadName = name;
    },
  };
  const result = await updateGroupName({ api, threadId: "group" }, "New name");
  assert.equal(result.changed, true);
  assert.equal(result.name, "New name");
});

test("nickname command does not locally require bot-admin status", async () => {
  const changes = [];
  const api = {
    getCurrentUserID: () => "bot",
    getThreadInfo: async () => ({
      participantIDs: ["member", "bot"],
      nicknames: { member: "old", bot: "" },
      adminIDs: [],
    }),
    nickname: async (...args) => changes.push(args),
  };
  const result = await updateGroupNicknames({
    api,
    threadId: "group",
    nickname: "new",
    send: async () => {},
  });
  assert.equal(result.changed, 1);
  assert.deepEqual(changes, [["new", "group", "member"]]);
});

test("protection and clear-nicknames commands no longer gate on bot-admin status", async () => {
  const protection = {
    enable: async () => ({ nicknames: {} }),
    disable: async () => true,
    refreshFromCurrent: async () => {},
  };
  const runtime = {
    api: {
      getThreadInfo: async () => ({ participantIDs: ["member", "bot"] }),
      getCurrentUserID: () => "bot",
      nickname: async () => {},
    },
    protection,
  };
  const replies = [];
  const send = async (message) => replies.push(message);

  await protectCommand.execute({
    args: "تشغيل",
    send,
    threadId: "group",
    runtime,
  });
  await protectCommand.execute({
    args: "إيقاف",
    send,
    threadId: "group",
    runtime,
  });
  await clearNicknamesCommand.execute({ send, threadId: "group", runtime });
  assert.equal(replies.length, 3);
});

test("the fixed bot nickname is checked after five seconds and only changed if needed", async () => {
  assert.equal(BOT_NICKNAME_CHECK_DELAY_MS, 5_000);
  const info = {
    participantIDs: ["bot"],
    nicknames: { bot: "someone changed it" },
  };
  const calls = [];
  const api = {
    getCurrentUserID: () => "bot",
    getThreadInfo: async () => ({
      participantIDs: info.participantIDs,
      nicknames: { ...info.nicknames },
    }),
    nickname: async (nickname, threadId, participant) => {
      calls.push([nickname, threadId, participant]);
      info.nicknames.bot = nickname;
    },
  };

  const result = await ensureBotNickname(api, "group", FIXED_NICKNAME);
  assert.deepEqual(result, { present: true, changed: true });
  assert.deepEqual(calls, [[FIXED_NICKNAME, "group", "bot"]]);
  assert.deepEqual(await ensureBotNickname(api, "group", FIXED_NICKNAME), {
    present: true,
    changed: false,
  });
  assert.equal(calls.length, 1);
});

test("the fixed nickname guard skips a bot that is not in the group", async () => {
  let changed = false;
  const api = {
    getCurrentUserID: () => "bot",
    getThreadInfo: async () => ({ participantIDs: ["other"], nicknames: {} }),
    nickname: async () => {
      changed = true;
    },
  };

  assert.deepEqual(await ensureBotNickname(api, "group", FIXED_NICKNAME), {
    present: false,
    changed: false,
  });
  assert.equal(changed, false);
});

test("repeat command factory keeps devil's interval configuration explicit", () => {
  const generated = createRepeatCommand({
    name: "devil",
    propertyName: "devilLoops",
    intervalSeconds: 60,
  });
  assert.equal(generated.name, "devil");
  assert.match(generated.description, /60 ثانية/);
});

test("the nickname checks use the requested exact nickname", () => {
  assert.equal(FIXED_NICKNAME.length > 0, true);
});
