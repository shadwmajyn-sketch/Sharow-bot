export function sendMessage(api, text, threadId, replyToMessageId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result);
    };
    const timeout = setTimeout(
      () => finish(new Error("Facebook message send timed out.")),
      12_000,
    );

    try {
      const result = api.sendMessageMqtt(
        text,
        threadId,
        replyToMessageId,
        (error, sentMessage) => finish(error, sentMessage),
      );
      if (result && typeof result.then === "function") {
        result.then((value) => finish(null, value), finish);
      }
    } catch (error) {
      finish(error);
    }
  });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
