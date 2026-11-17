import { describe, expect, mock, test } from "bun:test";

import { REAUTH_MESSAGE, createReauthNotice } from "./reauth";

describe("createReauthNotice", () => {
  test("starts clear", () => {
    expect(createReauthNotice().current()).toBeNull();
  });

  test("flagging sets the sign-in-again message and notifies", () => {
    const notice = createReauthNotice();
    const listener = mock(() => {});
    notice.subscribe(listener);

    notice.flag();
    expect(notice.current()).toBe(REAUTH_MESSAGE);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("clearing removes the message and notifies only on a change", () => {
    const notice = createReauthNotice();
    const listener = mock(() => {});
    notice.flag();
    notice.subscribe(listener);

    notice.clear();
    expect(notice.current()).toBeNull();
    notice.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("unsubscribing stops notifications", () => {
    const notice = createReauthNotice();
    const listener = mock(() => {});
    const unsubscribe = notice.subscribe(listener);
    unsubscribe();
    notice.flag();
    expect(listener).not.toHaveBeenCalled();
  });

  test("the message asks the user to sign in again, with no internals", () => {
    expect(REAUTH_MESSAGE).toBe("Sign in again to keep using AI generation.");
  });
});
