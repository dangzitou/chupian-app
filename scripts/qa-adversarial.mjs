#!/usr/bin/env node
import { request, printSummary } from "./qa-shared.mjs";

const results = [];

function addResult(name, pass, required, message, error) {
  results.push({ name, pass, required, message, error });
  printSummary(name, { passed: pass, required, message, error });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRateLimitHeaderPresent(res) {
  return Boolean(
    res.headers["ratelimit-limit"] ||
    res.headers["ratelimit-remaining"] ||
    res.headers["x-ratelimit-limit"] ||
    res.headers["x-ratelimit-remaining"]
  );
}

(async () => {
  let dbReady = false;
  try {
    const probe = await request("/api/v1/community/feed?limit=1");
    dbReady = probe.status === 200;
    addResult("adversarial:env-db-ready", dbReady, false, `database available: ${dbReady}`);
  } catch (err) {
    addResult("adversarial:env-db-ready", false, false, "database probe failed", err.message);
  }

  try {
    const malformed = await request("/api/v1/posts", {
      method: "POST",
      body: "{ \"title\": \"bad json\" ",
      headers: { "Content-Type": "application/json" },
    });
    assert(malformed.status === 400, `expected 400, got ${malformed.status}`);
    addResult("adversarial:malformed-json", true, false);
  } catch (err) {
    // express should respond 400 on parse failure
    addResult("adversarial:malformed-json", false, false, err.message);
  }

  try {
    const badPayload = {
      title: `x`.repeat(80),
      content: "a".repeat(4 * 1024 * 1024),
    };
    const tooBig = await request("/api/v1/posts", {
      method: "POST",
      body: JSON.stringify(badPayload),
    });
    assert(tooBig.status === 413, `expected 413, got ${tooBig.status}`);
    addResult("adversarial:max-body", true, false);
  } catch (err) {
    addResult("adversarial:max-body", false, false, err.message);
  }

  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "text/plain" });
    form.append("file", blob, "attack.exe");
    const badUpload = await request("/api/v1/media/upload", {
      method: "POST",
      body: form,
    });
    assert(badUpload.status === 415, `expected 415, got ${badUpload.status}`);
    addResult("adversarial:upload-invalid-type", true, false);
  } catch (err) {
    addResult("adversarial:upload-invalid-type", false, false, err.message);
  }

  try {
    const invalidId = await request("/api/v1/posts/not-a-number/like", {
      method: "POST",
      body: JSON.stringify({ action: "like", author: "qa" }),
    });
    assert(invalidId.status === 400, `expected 400, got ${invalidId.status}`);
    addResult("adversarial:path-id-pollution", true, false);
  } catch (err) {
    addResult("adversarial:path-id-pollution", false, false, err.message);
  }

  try {
    const cursor = await request("/api/v1/community/feed?cursor=bad|payload&limit=5");
    assert(cursor.status === 200, `expected 200, got ${cursor.status}`);
    assert(Array.isArray(cursor.json?.posts), "cursor response missing posts");
    addResult("adversarial:malicious-cursor", true, false);
  } catch (err) {
    addResult("adversarial:malicious-cursor", false, false, err.message);
  }

  try {
    const preflight = await request("/api/v1/posts", {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.invalid",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert([200, 204].includes(preflight.status), `expected 200/204, got ${preflight.status}`);
    addResult("adversarial:cors-preflight", true, false);
  } catch (err) {
    addResult("adversarial:cors-preflight", false, false, err.message);
  }

  try {
    const feed = await request("/api/v1/community/feed?limit=1");
    assert(isRateLimitHeaderPresent(feed), "rate-limit headers not found");
    addResult("adversarial:rate-limit-header", true, false);
  } catch (err) {
    addResult("adversarial:rate-limit-header", false, false, err.message);
  }

  if (dbReady) {
    const sqliPayload = {
      title: "x'); DROP TABLE posts;--",
      content: "<script>alert(1)</script>",
      media: [{ kind: "image", url: "https://picsum.photos/seed/sql/100/100" }],
    };
    const create = await request("/api/v1/posts", {
      method: "POST",
      body: JSON.stringify(sqliPayload),
    });
    if (create.status !== 200) {
      addResult("adversarial:sqli-like-input", false, false, `create failed: ${create.status}`);
    } else {
      const id = create.json?.post?.id;
      if (!Number.isInteger(id)) {
        addResult("adversarial:sqli-like-input", false, false, "create response missing id");
      } else {
        const fetched = await request(`/api/v1/posts/${id}`);
        assert(fetched.status === 200, `detail failed: ${fetched.status}`);
        addResult("adversarial:sqli-like-input", true, false);
      }
    }

    const post = await request("/api/v1/community/feed?limit=1");
    const candidate = (post.json?.posts || []).find((p) => p.id);
    if (candidate?.id) {
      const weirdAction = await request(`/api/v1/posts/${candidate.id}/like`, {
        method: "POST",
        body: JSON.stringify({ action: "destroy", author: "qa" }),
      });
      assert(weirdAction.status === 400, `expected 400 for invalid action, got ${weirdAction.status}`);
      addResult("adversarial:invalid-action", true, true);
    } else {
      addResult("adversarial:invalid-action", false, true, "no post found to verify invalid action");
      process.exitCode = 1;
    }
  } else {
    addResult("adversarial:invalid-action", false, false, "skipped (DB unavailable)");
  }

  const passed = results.filter((item) => item.pass).length;
  const failed = results.filter((item) => !item.pass && item.required).length;
  const warned = results.filter((item) => !item.pass && !item.required).length;
  console.log(`\n安全对抗测试汇总：${passed}/${results.length} 通过，${failed} 个致命项，${warned} 个告警`);
  if (failed > 0) process.exit(1);
})();
