# MusicFree 插件 · 自建曲库（Navidrome / Subsonic）

连接你自己的 Navidrome / Subsonic 自建音乐服务器，在 MusicFree 里搜索、播放、**下载**曲库里的音乐。
曲库里的文件本来就是你自己的，所以播放和下载都不涉及任何授权问题。

> 开发依据：MusicFree 官方 skill [`maotoumao/musicfree-skills`](https://github.com/maotoumao/musicfree-skills)
> （已下载到本目录 `.workbuddy/skills/musicfree-plugin-dev/`，插件协议见其中的 `references/plugin-protocol.md`）

---

## 这个插件能干什么

| 功能 | 对应方法 | 说明 |
| --- | --- | --- |
| 搜歌 / 搜专辑 / 搜歌手 / 搜歌单 | `search` | 走 Subsonic 的 `search3` |
| 播放 + **下载** | `getMediaSource` | 返回直链，MusicFree 播放和下载都用这个 |
| 歌词 | `getLyric` | 读取服务器上的歌词（放同名 `.lrc` 到音乐目录即可） |
| 歌曲详情补全 | `getMusicInfo` | 补封面、专辑名、时长 |
| 专辑详情 | `getAlbumInfo` | 列出整张专辑 |
| 歌单详情 | `getMusicSheetInfo` | 支持歌单，也支持按流派进来的专辑 |
| 歌手作品 | `getArtistWorks` | 专辑列表 + 歌曲 |
| 榜单 | `getTopLists` / `getTopListDetail` | 随机歌曲 / 我收藏的 / 正在播放 |
| 按流派浏览 | `getRecommendSheetTags` / `getRecommendSheetsByTag` | 用服务器的流派分类 |
| 导入单曲 / 歌单 | `importMusicItem` / `importMusicSheet` | 粘贴链接或 ID |

**音质映射**：标准 128k / 高品 192k / 超品（无损）→ 直接吐原文件（`format=raw`，FLAC、APE 原样下载，不转码）。
如果服务器没开转码，`maxBitRate` 会被忽略，各档拿到的都是原文件。

---

## 一、安装插件

**最省事的办法**：插件已经推到 GitHub 了，直接复制这一行链接，
在 MusicFree → **插件管理** → **从 URL 安装** 里粘贴即可：

```
https://raw.githubusercontent.com/weiyou777/musicfree-navidrome/main/navidrome.js
```

> 仓库：<https://github.com/weiyou777/musicfree-navidrome>

装完后点进插件 → **设置（用户变量）**，填三项：

| 变量 | 填什么 |
| --- | --- |
| `serverUrl` | 服务器地址，如 `https://music.example.com` 或 `http://192.168.1.10:4533`。**末尾不要带斜杠** |
| `username` | 登录用户名 |
| `password` | 登录密码 |

> 密码不会明文传输：插件用 `md5(密码 + 随机盐)` 生成 Subsonic 令牌，每次请求盐都不同。

4. 回到 MusicFree 搜索栏，随便搜一个词，能出结果就说明通了。

---

## 二、本地测试（可选，但建议先跑一遍）

```bash
npm install          # 只装本地测试用的 axios / crypto-js，插件本身不需要
npm run check        # 语法检查
npm test             # 完整接口测试
```

跑 `npm test` 时需要告诉它服务器信息，三选一：

```bash
# 方式 1：环境变量
SUBSONIC_URL=https://music.example.com SUBSONIC_USER=admin SUBSONIC_PASS=xxx npm test

# 方式 2：建一个 test-config.json
# { "serverUrl": "https://music.example.com", "username": "admin", "password": "xxx" }

# 方式 3：什么都不配，脚本会交互式问你
```

测试脚本会依次验证：连通性 → 搜歌 → 播放链接（标准/无损）→ 歌词 → 详情 → 专辑 → 歌手 → 歌单 → 榜单 → 流派，
每一项都打印 ✓ / ✗，失败会给出具体错误信息。

---

## 三、没有 Navidrome 服务器怎么办

Navidrome 是最省事的方案（Go 单文件，支持 Windows / macOS / Linux / Docker）：

```bash
# Docker 一行起
docker run -d --name navidrome \
  -p 4533:4533 \
  -v /path/to/your/music:/music \
  -v /path/to/data:/data \
  deluan/navidrome:latest
```

然后浏览器打开 `http://localhost:4533` 建账号、扫库，就能用这个插件了。

---

## 四、常见问题

**搜不到东西** → 先在 Navidrome 里确认音乐已经扫描入库（设置 → 立即扫描）；再确认搜索类型切到了「单曲/专辑/歌手」。

**能搜到但播放失败** → 大概率是 `serverUrl` 填的地址在手机/当前网络下访问不到。局域网地址（`192.168.x.x`）在手机端要连同一个 Wi-Fi；外网访问建议配 HTTPS 域名。

**下载下来是转码后的文件** → 把音质切到「超品/无损」，插件会走 `format=raw` 拿原文件。

**歌词取不到** → 服务器本身没有歌词数据。把 `xxx.lrc` 和 `xxx.mp3` 放同一目录，重新扫描即可。

**按流派浏览是空的** → 部分服务器不支持 `byGenre`（代码里已静默降级，不影响其它功能）。

---

## 五、更新插件

1. 改 `navidrome.js` 里的 `version`（语义化版本，`0.1.0` → `0.1.1`）。
2. 推到 GitHub。
3. 在插件里填 `srcUrl` 为 raw 链接（当前版本没填，填了之后 MusicFree 里就能点「更新插件」）。
