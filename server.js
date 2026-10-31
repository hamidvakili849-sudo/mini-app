
require("dotenv").config();

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("فقط فایل صوتی مجاز است."));
    }
  }
});

function getPlatform(url) {
  const host = new URL(url).hostname.toLowerCase();

  if (host.includes("youtube.com") || host.includes("youtu.be"))
    return "YouTube";

  if (host.includes("spotify.com"))
    return "Spotify";

  if (host.includes("soundcloud.com"))
    return "SoundCloud";

  if (host.includes("music.apple.com"))
    return "Apple Music";

  return "Unknown";
}

async function getMetadata(url, platform) {
  let endpoint;

  if (platform === "Spotify") {
    endpoint = "https://open.spotify.com/oembed?url=" +
      encodeURIComponent(url);
  } else if (platform === "SoundCloud") {
    endpoint = "https://soundcloud.com/oembed?format=json&url=" +
      encodeURIComponent(url);
  } else if (platform === "YouTube") {
    endpoint = "https://www.youtube.com/oembed?format=json&url=" +
      encodeURIComponent(url);
  } else if (platform === "Apple Music") {
    endpoint = "https://embed.music.apple.com/oembed?url=" +
      encodeURIComponent(url);
  } else {
    throw new Error("این سایت پشتیبانی نمی‌شود.");
  }

  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error("اطلاعات لینک دریافت نشد.");
  }

  const data = await response.json();

  return {
    platform,
    title: data.title || "نامشخص",
    artist: data.author_name || "نامشخص",
    thumbnail: data.thumbnail_url || "",
    source: url
  };
}

app.post("/api/search", async (req, res) => {
  try {
    const url = String(req.body.url || "").trim();
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error("لینک نامعتبر است.");

    const platform = getPlatform(url);
    const result = await getMetadata(url, platform);

    res.json({
      success: true,
      result
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// تشخیص آهنگ از نمونه صوتی با ACRCloud
app.post("/api/identify", (req, res) => {
  upload.single("audio")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "فایل صوتی ارسال نشده است."
        });
      }

      const host = process.env.ACRCLOUD_HOST;
      const key = process.env.ACRCLOUD_ACCESS_KEY;
      const secret = process.env.ACRCLOUD_ACCESS_SECRET;

      if (!host || !key || !secret) {
        return res.status(503).json({
          success: false,
          message: "سرویس تشخیص آهنگ هنوز تنظیم نشده است."
        });
      }

      const endpoint = "/v1/identify";
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const dataType = "audio";

      const stringToSign = [
        "POST",
        endpoint,
        key,
        dataType,
        timestamp
      ].join("\n");

      const signature = crypto
        .createHmac("sha1", secret)
        .update(stringToSign)
        .digest("base64");

      const form = new FormData();

      form.append("access_key", key);
      form.append("data_type", dataType);
      form.append("signature_version", "1");
      form.append("signature", signature);
      form.append("timestamp", timestamp);
      form.append("sample_bytes", String(req.file.buffer.length));

      form.append(
        "sample",
        new Blob([req.file.buffer], {
          type: req.file.mimetype
        }),
        req.file.originalname
      );

      const response = await fetch(
        `https://${host}${endpoint}`,
        {
          method: "POST",
          body: form
        }
      );

      const data = await response.json();

      if (data.status?.code !== 0) {
        throw new Error("آهنگ شناسایی نشد.");
      }

      const music = data.metadata?.music?.[0];

      if (!music) {
        throw new Error("نتیجه‌ای پیدا نشد.");
      }

      res.json({
        success: true,
        result: {
          title: music.title,
          artist: music.artists?.map(a => a.name).join(", "),
          album: music.album?.name || "",
          releaseDate: music.release_date || ""
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("PICO MUSIC is running!");
});
