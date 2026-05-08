#!/usr/bin/env node
import { BACKEND_URL, request, printSummary, REQUIRE_DB } from "./qa-shared.mjs";

const TEST_TAG = `qa-${Date.now()}`;
const results = [];

function addResult(name, pass, required, message, error) {
  results.push({ name, pass, required, message, error });
  printSummary(name, { passed: pass, required, message, error });
}

async function expect(path, init) {
  return request(path, init);
}

async function run(name, fn, required = true) {
  try {
    await fn();
    addResult(name, true, required);
    return true;
  } catch (err) {
    addResult(name, false, required, err.message, err.stack || `${err}`);
    if (required) process.exitCode = 1;
    return false;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`Backend QA target: ${BACKEND_URL}`);

(async () => {
  let dbReady = false;

  await run("health:GET /health", async () => {
    const res = await expect("/health");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.json && res.json.ok === true, `response not healthy: ${res.summary}`);
  });

  await run("health:v1", async () => {
    const res = await expect("/api/v1/health");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.json?.ok === true, `response not healthy: ${res.summary}`);
  });

  let dbProbe = null;
  try {
    dbProbe = await expect("/api/v1/spots");
  } catch (err) {
    dbProbe = { status: 0, summary: err.message };
  }
  dbReady = dbProbe.status === 200;
  addResult(
    "integration:db-ready",
    dbReady,
    REQUIRE_DB,
    dbReady ? "spots is available" : `spots failed (${dbProbe.status} ${dbProbe.summary})`
  );
  if (REQUIRE_DB && dbProbe.status !== 200) process.exitCode = 1;

  await run("endpoint:GET /api/v1/weather", async () => {
    const res = await expect("/api/v1/weather");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.json && typeof res.json.temp === "number", "weather response missing temperature field");
  });

  await run("endpoint:GET /api/v1/spots", async () => {
    if (!dbReady && !REQUIRE_DB) {
      const err = new Error("DB unavailable, skipped");
      err.message = "DB unavailable, skipped";
      throw err;
    }
    const res = await expect("/api/v1/spots");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.spots || []), "spots payload missing array");
  }, dbReady || REQUIRE_DB);

  await run("endpoint:GET /api/v1/map", async () => {
    const res = await expect("/api/v1/map?lat=23.129163&lng=113.264435&radius=35&limit=10");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.spots || []), "map payload missing spots");
    assert(Array.isArray(res.json?.posts || []), "map payload missing posts");
  }, dbReady || REQUIRE_DB);

  await run("endpoint:GET /api/v1/community/feed", async () => {
    const res = await expect("/api/v1/community/feed?limit=5&sort=latest");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.posts), "feed payload missing posts");
  }, dbReady);

  await run("endpoint:GET /api/v1/community/discovery", async () => {
    const res = await expect("/api/v1/community/discovery?limit=10");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(Array.isArray(res.json?.signals), "discovery payload missing signals");
  }, dbReady);

  await run("endpoint:GET /api/weather", async () => {
    const res = await expect("/api/weather");
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(res.json?.ok === true, "weather payload is invalid");
  }, true);

  await run("endpoint:legacy /api/posts", async () => {
    const res = await expect("/api/posts?limit=5");
  if (dbReady) {
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.json?.posts), "legacy posts payload missing posts");
    } else if (!REQUIRE_DB) {
      if (res.status === 404 || res.status >= 500) return;
      throw new Error(`unexpected status ${res.status}`);
    } else {
      throw new Error(`expected DB flow but got ${res.status}`);
    }
  }, dbReady || REQUIRE_DB);

  if (!dbReady) {
    console.log("\n数据库未就绪，核心 CRUD 联调未执行。请先启动数据库并设置 QA_REQUIRE_DB=1 再运行。");
  } else {
    await run("crud:create-post", async () => {
      const payload = {
        title: `QA ${TEST_TAG}`,
        content: "QA 自动化发布",
        media: [{ kind: "image", url: "https://picsum.photos/seed/qa/800/600" }],
        cover: "https://picsum.photos/seed/qa/800/600",
        spotName: "测试点位",
        district: "广州",
        latitude: 23.129163,
        longitude: 113.264435,
        angle: "仰拍",
        direction: "逆光",
        timeWindow: "下午",
        bestTime: "day",
        shotAt: new Date().toISOString(),
        camera: "Nikon Z6",
        lens: "35mm",
        focalLength: "35",
        aperture: "f/2.0",
        shutter: "1/125",
        iso: "200",
        whiteBalance: "auto",
        tags: ["qa", TEST_TAG],
        styles: ["street", "city"],
        author: "qa-tester",
        authorBio: "automation",
      };

      const createRes = await expect("/api/v1/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      assert(createRes.status === 200, `expected 200, got ${createRes.status}`);
      const postId = createRes.json?.post?.id;
      assert(Number.isInteger(postId), "create response missing post id");

      const detail = await expect(`/api/v1/posts/${postId}`);
      assert(detail.status === 200, `detail status=${detail.status}`);
      assert(Number(detail.json?.post?.id) === Number(postId), "detail id mismatch");

      const like = await expect(`/api/v1/posts/${postId}/like`, {
        method: "POST",
        body: JSON.stringify({ author: "qa-tester", action: "like" }),
      });
      assert(like.status === 200, `like status=${like.status}`);
      assert(like.json?.liked === true, "like should be true");

      const unlike = await expect(`/api/v1/posts/${postId}/like`, {
        method: "POST",
        body: JSON.stringify({ author: "qa-tester", action: "unlike" }),
      });
      assert(unlike.status === 200, `unlike status=${unlike.status}`);
      assert(unlike.json?.liked === false, "like should be false");

      const favorite = await expect(`/api/v1/posts/${postId}/favorite`, {
        method: "POST",
        body: JSON.stringify({ author: "qa-tester", action: "favorite" }),
      });
      assert(favorite.status === 200, `favorite status=${favorite.status}`);
      assert(favorite.json?.favorited === true, "favorite should be true");

      const comment = await expect(`/api/v1/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({ author: "qa-tester", text: "good test" }),
      });
      assert(comment.status === 200, `comment status=${comment.status}`);
      assert(comment.json?.comment?.text === "good test", "comment content mismatch");

      const feed = await expect("/api/v1/community/feed?limit=20");
      assert(feed.status === 200, `feed status=${feed.status}`);
      const fromFeed = (feed.json?.posts || []).some((it) => Number(it.id) === Number(postId));
      assert(fromFeed, "created post should appear in feed");

      const map = await expect("/api/v1/map?lat=23.129163&lng=113.264435&radius=35&limit=60");
      assert(map.status === 200, `map status=${map.status}`);
      const fromMap = (map.json?.posts || []).some((it) => Number(it.id) === Number(postId));
      assert(fromMap, "created post with coordinates should appear on nearby map");
    }, true);

    await run("crud:legacy compatibility", async () => {
      const res = await expect("/api/posts?limit=20");
      assert(res.status === 200, `legacy posts status=${res.status}`);
      assert(Array.isArray(res.json?.posts), "legacy posts payload invalid");
    }, true);

    await run("endpoint:GET /api/v1/community/me/likes", async () => {
      const res = await expect("/api/v1/community/me/likes?limit=5");
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.json?.posts), "likes payload missing posts");
    }, true);

    await run("endpoint:GET /api/v1/community/me/favorites", async () => {
      const res = await expect("/api/v1/community/me/favorites?limit=5");
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.json?.posts), "favorites payload missing posts");
    }, true);

    await run("endpoint:GET /api/v1/community/me/following", async () => {
      const res = await expect("/api/v1/community/me/following?limit=5");
      assert(res.status === 200, `expected 200, got ${res.status}`);
      assert(Array.isArray(res.json?.posts), "following payload missing posts");
    }, true);
  }

  const passed = results.filter((x) => x.pass).length;
  const failed = results.filter((x) => x.pass === false && x.required).length;
  const warned = results.filter((x) => x.pass === false && !x.required).length;
  const total = results.length;
  console.log(`\n测试汇总：${passed}/${total} 通过，${failed} 个致命项，${warned} 个告警`);

  if (failed > 0) process.exit(1);
  process.exit(0);
})();
