const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const DEFAULT_OWNER = "AzerStudio-Dev";
const DEFAULT_REPO = "AzerAI-App";

function parseRepoFromPackage(pkg) {
  const raw = pkg?.repository;
  const url = typeof raw === "string" ? raw : raw?.url;
  if (!url) {
    return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
  }

  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (!match) {
    return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
  }

  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0];
}

function parseVersionParts(version) {
  return normalizeVersion(version)
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
}

function isNewerVersion(latest, current) {
  const a = parseVersionParts(latest);
  const b = parseVersionParts(current);

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }

  return false;
}

function requestJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? http : https;

    const req = transport.get(
      url,
      {
        headers: {
          "User-Agent": "AzerAI-App-Updater",
          Accept: "application/vnd.github+json",
          ...headers,
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          requestJson(res.headers.location, headers).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API xətası: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("GitHub sorğusu vaxtı bitdi"));
    });
  });
}

function getPlatformAssetProfile(platform = process.platform) {
  if (platform === "darwin") {
    return {
      extensions: [/\.dmg$/i, /\.zip$/i],
      preferredWords: ["dmg", "mac", "darwin"],
      fallbackWords: ["zip"],
    };
  }

  if (platform === "linux") {
    return {
      extensions: [/\.appimage$/i, /\.deb$/i, /\.tar\.gz$/i],
      preferredWords: ["appimage", "linux"],
      fallbackWords: ["deb", "tar.gz"],
    };
  }

  return {
    extensions: [/\.exe$/i],
    preferredWords: ["setup", "installer", "nsis"],
    fallbackWords: ["portable"],
  };
}

function getArchWords(arch = process.arch) {
  if (arch === "x64") return ["x64", "amd64"];
  if (arch === "arm64") return ["arm64", "aarch64", "universal"];
  if (arch === "ia32") return ["ia32", "x86"];
  return [arch].filter(Boolean);
}

function pickReleaseAsset(assets = [], options = {}) {
  const profile = getPlatformAssetProfile(options.platform);
  const archWords = getArchWords(options.arch);
  const candidates = assets.filter((asset) => {
    const name = asset.name || "";
    return profile.extensions.some((pattern) => pattern.test(name));
  });

  if (candidates.length === 0) {
    return null;
  }

  const score = (asset) => {
    const lower = (asset.name || "").toLowerCase();
    let value = 100;

    const preferredIndex = profile.preferredWords.findIndex((word) =>
      lower.includes(word)
    );
    if (preferredIndex >= 0) value -= 30 - preferredIndex;

    const fallbackIndex = profile.fallbackWords.findIndex((word) =>
      lower.includes(word)
    );
    if (fallbackIndex >= 0) value -= 10 - fallbackIndex;

    if (archWords.some((word) => lower.includes(word))) value -= 20;
    if (lower.includes("universal")) value -= 12;

    return value;
  };

  return [...candidates].sort((a, b) => score(a) - score(b))[0];
}

async function checkForUpdate(currentVersion, pkg, options = {}) {
  const { owner, repo } = parseRepoFromPackage(pkg);
  const release = await requestJson(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`
  );

  const latestVersion = normalizeVersion(release.tag_name);
  const current = normalizeVersion(currentVersion);
  const asset = pickReleaseAsset(release.assets || [], options);

  return {
    updateAvailable: isNewerVersion(latestVersion, current),
    currentVersion: current,
    latestVersion,
    releaseNotes: release.body || "",
    releaseUrl: release.html_url,
    downloadUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    owner,
    repo,
    platform: options.platform || process.platform,
    arch: options.arch || process.arch,
  };
}

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "http:" ? http : https;

    const requestFile = (targetUrl) => {
      const req = transport.get(targetUrl, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          requestFile(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Yükləmə xətası: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        const total = Number(res.headers["content-length"] || 0);
        let downloaded = 0;

        const fileStream = fs.createWriteStream(destination);
        res.on("data", (chunk) => {
          downloaded += chunk.length;
          if (typeof onProgress === "function" && total > 0) {
            onProgress({
              percent: Math.min(100, Math.round((downloaded / total) * 100)),
              transferred: downloaded,
              total,
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => resolve(destination));
        });

        fileStream.on("error", (error) => {
          fs.unlink(destination, () => reject(error));
        });
      });

      req.on("error", reject);
      req.setTimeout(120000, () => {
        req.destroy(new Error("Yükləmə vaxtı bitdi"));
      });
    };

    requestFile(url);
  });
}

async function downloadUpdate(downloadUrl, assetName, onProgress) {
  const safeName = path.basename(assetName || "AzerAI-App-Update.exe");
  const destination = path.join(
    require("os").tmpdir(),
    `azerai-update-${Date.now()}-${safeName}`
  );

  await downloadFile(downloadUrl, destination, onProgress);
  return destination;
}

module.exports = {
  checkForUpdate,
  downloadUpdate,
  isNewerVersion,
  normalizeVersion,
  pickReleaseAsset,
};
