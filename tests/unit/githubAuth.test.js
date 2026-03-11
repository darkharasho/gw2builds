"use strict";

// githubAuth.js imports `shell` from `electron`, which we must mock
jest.mock("electron", () => ({
  shell: {
    openExternal: jest.fn(() => Promise.resolve()),
  },
}));

const { beginGitHubDeviceAuth, completeGitHubDeviceAuth } = require("../../src/main/githubAuth");
const { shell } = require("electron");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHeaders() {
  return { get: () => null };
}

function okRes(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: makeHeaders(),
  });
}

function failRes(status, data = {}) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: makeHeaders(),
  });
}

const FAKE_CLIENT_ID = "Iv1.abcdefgh12345678";
const FAKE_DEVICE_CODE = "device_code_abc";
const FAKE_USER_CODE = "ABCD-EFGH";
const FAKE_VERIFICATION_URI = "https://github.com/login/device";
const FAKE_TOKEN = "ghs_real_access_token";

// ---------------------------------------------------------------------------
// beginGitHubDeviceAuth
// ---------------------------------------------------------------------------

describe("beginGitHubDeviceAuth", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    shell.openExternal.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test("throws when clientId is missing", async () => {
    await expect(beginGitHubDeviceAuth("")).rejects.toThrow("Missing GITHUB_OAUTH_CLIENT_ID");
    await expect(beginGitHubDeviceAuth(null)).rejects.toThrow("Missing GITHUB_OAUTH_CLIENT_ID");
    await expect(beginGitHubDeviceAuth(undefined)).rejects.toThrow("Missing GITHUB_OAUTH_CLIENT_ID");
  });

  test("sends POST to /login/device/code with correct body", async () => {
    global.fetch = jest.fn(() => okRes({
      device_code: FAKE_DEVICE_CODE,
      user_code: FAKE_USER_CODE,
      verification_uri: FAKE_VERIFICATION_URI,
      interval: 5,
      expires_in: 900,
    }));

    await beginGitHubDeviceAuth(FAKE_CLIENT_ID);

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/login/device/code");
    expect(init.method).toBe("POST");
    expect(init.headers["Accept"]).toBe("application/json");
    // Body should include client_id and scope
    const bodyStr = init.body instanceof URLSearchParams
      ? init.body.toString()
      : String(init.body);
    expect(bodyStr).toContain("client_id=" + encodeURIComponent(FAKE_CLIENT_ID));
    expect(bodyStr).toContain("scope=");
  });

  test("scope includes repo, read:user, read:org, workflow", async () => {
    global.fetch = jest.fn(() => okRes({
      device_code: FAKE_DEVICE_CODE,
      user_code: FAKE_USER_CODE,
      verification_uri: FAKE_VERIFICATION_URI,
      interval: 5,
      expires_in: 900,
    }));

    await beginGitHubDeviceAuth(FAKE_CLIENT_ID);
    const [, init] = global.fetch.mock.calls[0];
    const bodyStr = init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
    expect(decodeURIComponent(bodyStr)).toContain("repo");
    expect(decodeURIComponent(bodyStr)).toContain("read:user");
    expect(decodeURIComponent(bodyStr)).toContain("read:org");
    expect(decodeURIComponent(bodyStr)).toContain("workflow");
  });

  test("opens browser with verification_uri", async () => {
    global.fetch = jest.fn(() => okRes({
      device_code: FAKE_DEVICE_CODE,
      user_code: FAKE_USER_CODE,
      verification_uri: FAKE_VERIFICATION_URI,
      interval: 5,
      expires_in: 900,
    }));

    await beginGitHubDeviceAuth(FAKE_CLIENT_ID);
    expect(shell.openExternal).toHaveBeenCalledWith(FAKE_VERIFICATION_URI);
  });

  test("returns object with deviceCode, userCode, verificationUri, interval, expiresIn", async () => {
    global.fetch = jest.fn(() => okRes({
      device_code: FAKE_DEVICE_CODE,
      user_code: FAKE_USER_CODE,
      verification_uri: FAKE_VERIFICATION_URI,
      interval: 7,
      expires_in: 600,
    }));

    const result = await beginGitHubDeviceAuth(FAKE_CLIENT_ID);
    expect(result.deviceCode).toBe(FAKE_DEVICE_CODE);
    expect(result.userCode).toBe(FAKE_USER_CODE);
    expect(result.verificationUri).toBe(FAKE_VERIFICATION_URI);
    expect(result.interval).toBe(7);
    expect(result.expiresIn).toBe(600);
  });

  test("defaults interval to 5 when API omits it", async () => {
    global.fetch = jest.fn(() => okRes({
      device_code: FAKE_DEVICE_CODE,
      user_code: FAKE_USER_CODE,
      verification_uri: FAKE_VERIFICATION_URI,
      expires_in: 900,
      // interval omitted
    }));
    const result = await beginGitHubDeviceAuth(FAKE_CLIENT_ID);
    expect(result.interval).toBe(5);
  });

  test("defaults expiresIn to 900 when API omits it", async () => {
    global.fetch = jest.fn(() => okRes({
      device_code: FAKE_DEVICE_CODE,
      user_code: FAKE_USER_CODE,
      verification_uri: FAKE_VERIFICATION_URI,
      interval: 5,
      // expires_in omitted
    }));
    const result = await beginGitHubDeviceAuth(FAKE_CLIENT_ID);
    expect(result.expiresIn).toBe(900);
  });

  test("throws when API response does not include device_code", async () => {
    global.fetch = jest.fn(() => okRes({ user_code: "ABCD" })); // no device_code
    await expect(beginGitHubDeviceAuth(FAKE_CLIENT_ID)).rejects.toThrow("device code");
  });

  test("throws when API returns non-OK status", async () => {
    global.fetch = jest.fn(() => failRes(400));
    await expect(beginGitHubDeviceAuth(FAKE_CLIENT_ID)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// completeGitHubDeviceAuth / pollAccessToken
// ---------------------------------------------------------------------------

describe("completeGitHubDeviceAuth", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    delete global.fetch;
  });

  test("throws when clientId is missing", async () => {
    await expect(completeGitHubDeviceAuth("", FAKE_DEVICE_CODE, 5, 900))
      .rejects.toThrow("Missing GITHUB_OAUTH_CLIENT_ID");
  });

  test("throws when deviceCode is missing", async () => {
    await expect(completeGitHubDeviceAuth(FAKE_CLIENT_ID, "", 5, 900))
      .rejects.toThrow("Missing GitHub device code");
  });

  test("returns access token on first successful poll", async () => {
    global.fetch = jest.fn(() => okRes({ access_token: FAKE_TOKEN }));

    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 5, 900);
    // Advance timers to trigger the first polling interval
    await Promise.resolve();
    jest.advanceTimersByTime(6000); // > 5s interval
    await Promise.resolve();
    jest.useRealTimers();

    const token = await promise;
    expect(token).toBe(FAKE_TOKEN);
  });

  test("retries on authorization_pending and succeeds on second poll", async () => {
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) return okRes({ error: "authorization_pending" });
      return okRes({ access_token: FAKE_TOKEN });
    });

    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 1, 900);
    // Advance through 2 polling intervals
    for (let i = 0; i < 4; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    }
    jest.useRealTimers();

    const token = await promise;
    expect(token).toBe(FAKE_TOKEN);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test("increases polling interval on slow_down response", async () => {
    let callCount = 0;
    let capturedIntervals = [];
    let lastCallTime = Date.now();

    global.fetch = jest.fn(async () => {
      callCount++;
      if (callCount === 1) return okRes({ error: "slow_down" });
      return okRes({ access_token: FAKE_TOKEN });
    });

    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 1, 900);
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(7000); // enough for slow_down increased interval
      await Promise.resolve();
    }
    jest.useRealTimers();

    const token = await promise;
    // After slow_down (adds 5000ms), interval becomes 1s + 5s = 6s minimum
    expect(token).toBe(FAKE_TOKEN);
  });

  test("throws on expired_token error", async () => {
    global.fetch = jest.fn(() => okRes({ error: "expired_token" }));

    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 1, 900);
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    jest.useRealTimers();

    await expect(promise).rejects.toThrow("expired");
  });

  test("throws on unknown OAuth error", async () => {
    global.fetch = jest.fn(() => okRes({ error: "access_denied" }));

    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 1, 900);
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    jest.useRealTimers();

    await expect(promise).rejects.toThrow("access_denied");
  });

  test("throws timed out when expiresIn is very short", async () => {
    global.fetch = jest.fn(() => okRes({ error: "authorization_pending" }));

    // expiresIn=1 second — will time out after 1 poll interval
    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 5, 1);
    // Advance time beyond expiry
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    }
    jest.useRealTimers();

    await expect(promise).rejects.toThrow("timed out");
  });

  test("throws when API returns non-OK status during poll", async () => {
    global.fetch = jest.fn(() => failRes(500));

    const promise = completeGitHubDeviceAuth(FAKE_CLIENT_ID, FAKE_DEVICE_CODE, 1, 900);
    await Promise.resolve();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();
    jest.useRealTimers();

    await expect(promise).rejects.toThrow();
  });
});
