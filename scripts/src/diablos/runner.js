import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = fileURLToPath(new URL("./", import.meta.url));
const entry = path.join(directory, "index.js");
const watchedFile = "appstate.json";
const debounceMs = 800;

let child = null;
let restartTimer = null;
let childRestartTimer = null;
let stableTimer = null;
let childRestartAttempts = 0;
let restarting = false;
let shuttingDown = false;
const childRestartBaseDelayMs = 5_000;
const childRestartMaxDelayMs = 60_000;
const stableRunBeforeResetMs = 60_000;

function log(message) {
  process.stdout.write(`[Diablos runner] ${message}\n`);
}

function startBot() {
  if (shuttingDown) return;
  child = spawn(process.execPath, [entry], {
    cwd: directory,
    env: process.env,
    stdio: "inherit",
  });

  const currentChild = child;
  currentChild.once("error", (error) => {
    log(`Could not start the bot process: ${error.message}`);
  });
  clearTimeout(stableTimer);
  stableTimer = setTimeout(() => {
    if (child === currentChild) childRestartAttempts = 0;
  }, stableRunBeforeResetMs);
  currentChild.once("exit", (code, signal) => {
    if (child !== currentChild) return;
    child = null;
    clearTimeout(stableTimer);
    stableTimer = null;
    if (!shuttingDown && !restarting) {
      log(
        code === 0
          ? "The bot process stopped."
          : `The bot process exited (${signal ?? code}).`,
      );
      scheduleChildRestart();
    }
  });
}

function scheduleChildRestart() {
  if (shuttingDown || restarting || childRestartTimer) return;
  const exponent = Math.min(childRestartAttempts, 4);
  const waitMs = Math.min(
    childRestartBaseDelayMs * 2 ** exponent,
    childRestartMaxDelayMs,
  );
  childRestartAttempts += 1;
  log(`Retrying the bot process in ${Math.round(waitMs / 1000)} seconds.`);
  childRestartTimer = setTimeout(() => {
    childRestartTimer = null;
    startBot();
  }, waitMs);
}

async function stopBot() {
  const currentChild = child;
  if (
    !currentChild ||
    currentChild.exitCode !== null ||
    currentChild.signalCode !== null
  ) {
    return;
  }

  currentChild.kill("SIGTERM");
  let timeout;
  await Promise.race([
    once(currentChild, "exit"),
    new Promise((resolve) => {
      timeout = setTimeout(resolve, 5000);
    }),
  ]);
  clearTimeout(timeout);

  if (currentChild.exitCode === null && currentChild.signalCode === null) {
    currentChild.kill("SIGKILL");
  }
}

async function restartBot() {
  if (restarting || shuttingDown) return;
  restarting = true;
  clearTimeout(childRestartTimer);
  childRestartTimer = null;
  log("appstate.json changed; reconnecting with the saved session.");
  try {
    await stopBot();
    if (!shuttingDown) startBot();
  } finally {
    restarting = false;
  }
}

function scheduleRestart() {
  if (shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    void restartBot();
  }, debounceMs);
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(restartTimer);
  clearTimeout(childRestartTimer);
  clearTimeout(stableTimer);
  watcher.close();
  log(`Stopping on ${signal}.`);
  void stopBot().finally(() => process.exit(0));
}

let watcher;
try {
  watcher = watch(directory, (_eventType, filename) => {
    if (filename?.toString() === watchedFile) scheduleRestart();
  });
} catch (error) {
  log(`Could not watch appstate.json: ${error.message}`);
  process.exitCode = 1;
  process.exit();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startBot();
