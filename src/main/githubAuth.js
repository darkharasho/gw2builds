const { shell } = require("electron");

const GITHUB_API = "https://github.com";
const UA = "axiforge-desktop";

async function requestDeviceCode(clientId) {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: "repo read:user read:org workflow",
  });

  const res = await fetch(`${GITHUB_API}/login/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Failed to request device code (${res.status})`);
  }

  const data = await res.json();
  if (!data.device_code) {
    throw new Error("GitHub did not return a device code.");
  }
  return data;
}

async function pollAccessToken(clientId, deviceCode, intervalSeconds, expiresInSeconds) {
  const expiresAt = Date.now() + expiresInSeconds * 1000;
  let intervalMs = Math.max(intervalSeconds, 1) * 1000;

  while (Date.now() < expiresAt) {
    await delay(intervalMs);

    const body = new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    const res = await fetch(`${GITHUB_API}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`Failed to poll OAuth token (${res.status})`);
    }

    const data = await res.json();
    if (data.access_token) {
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      continue;
    }
    if (data.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (data.error === "expired_token") {
      throw new Error("GitHub login expired before authorization completed.");
    }

    throw new Error(`GitHub OAuth error: ${data.error || "unknown_error"}`);
  }

  throw new Error("GitHub login timed out.");
}

async function startGitHubDeviceAuth(clientId) {
  if (!clientId) {
    throw new Error("Missing GITHUB_OAUTH_CLIENT_ID in environment.");
  }

  const begin = await beginGitHubDeviceAuth(clientId);
  const token = await completeGitHubDeviceAuth(clientId, begin.deviceCode, begin.interval, begin.expiresIn);
  return { token, userCode: begin.userCode, verificationUri: begin.verificationUri };
}

async function beginGitHubDeviceAuth(clientId) {
  if (!clientId) {
    throw new Error("Missing GITHUB_OAUTH_CLIENT_ID in environment.");
  }
  const codeData = await requestDeviceCode(clientId);
  await shell.openExternal(codeData.verification_uri);
  return {
    deviceCode: codeData.device_code,
    userCode: codeData.user_code,
    verificationUri: codeData.verification_uri,
    interval: codeData.interval || 5,
    expiresIn: codeData.expires_in || 900,
  };
}

async function completeGitHubDeviceAuth(clientId, deviceCode, interval, expiresIn) {
  if (!clientId) {
    throw new Error("Missing GITHUB_OAUTH_CLIENT_ID in environment.");
  }
  if (!deviceCode) {
    throw new Error("Missing GitHub device code.");
  }
  return pollAccessToken(clientId, deviceCode, interval || 5, expiresIn || 900);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  startGitHubDeviceAuth,
  beginGitHubDeviceAuth,
  completeGitHubDeviceAuth,
};
