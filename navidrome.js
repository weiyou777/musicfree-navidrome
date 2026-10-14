/**
 * MusicFree 插件：自建曲库（Navidrome / Subsonic 兼容）
 *
 * 支持的服务器：Navidrome、Airsonic、Supysonic、Funkwhale 等一切兼容
 * Subsonic API 的自建音乐服务。播放和下载的都是你自己曲库里的文件。
 *
 * 配置：在 MusicFree 的「插件设置 → 用户变量」里填写
 *   serverUrl  服务器地址，如 https://music.example.com（末尾不要带 /）
 *   username   用户名
 *   password   密码
 */

const axios = require('axios');
const CryptoJS = require('crypto-js');

const API_VERSION = '1.16.1';
const CLIENT_NAME = 'MusicFree';
const PAGE_SIZE = 30;
const COVER_SIZE = 500;

/* ============================================================
 * 基础工具
 * ========================================================== */

/** 读取用户变量（本地 Node 测试时 env 由测试脚本注入） */
function getConfig() {
    var vars = {};
    if (typeof env !== 'undefined' && env && typeof env.getUserVariables === 'function') {
        vars = env.getUserVariables() || {};
    }
    var serverUrl = String(vars.serverUrl || '').replace(/\/+$/, '');
    var username = String(vars.username || '');
    var password = String(vars.password || '');
    if (!serverUrl) throw new Error('未配置服务器地址：请在插件设置里填写 serverUrl');
    if (!username) throw new Error('未配置用户名：请在插件设置里填写 username');
    if (!password) throw new Error('未配置密码：请在插件设置里填写 password');
    return { serverUrl: serverUrl, username: username, password: password };
}

/** Subsonic 的 token 鉴权：t = md5(password + salt) */
function randomSalt() {
    var chars = '0123456789abcdef';
    var s = '';
    for (var i = 0; i < 12; i++) {
        s += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return s;
}

function authParams(cfg) {
    var salt = randomSalt();
    var token = CryptoJS.MD5(cfg.password + salt).toString(CryptoJS.enc.Hex);
    return {
        u: cfg.username,
        t: token,
        s: salt,
        v: API_VERSION,
        c: CLIENT_NAME,
        f: 'json'
    };
}

/** 拼出完整的 Subsonic 接口地址（含鉴权参数） */
function buildUrl(cfg, method, extra) {
    var params = authParams(cfg);
    var keys = [];
    var k;
    for (k in extra) {
        if (extra.hasOwnProperty(k)) {
            params[k] = extra[k];
        }
    }
    for (k in params) {
        if (params.hasOwnProperty(k) && params[k] !== undefined && params[k] !== null && params[k] !== '') {
            keys.push(k);
        }
    }
    var qs = keys
        .map(function (key) {
            return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
        })
        .join('&');
    return cfg.serverUrl + '/rest/' + method + '.view?' + qs;
}

/** 统一请求 + 错误检查；返回 subsonic-response 里的数据体 */
async function subsonic(cfg, method, extra) {
    var url = buildUrl(cfg, method, extra);
    var res = await axios.get(url, {
        timeout: 9000,
        headers: { 'User-Agent': CLIENT_NAME }
    });
    var body = res.data;
    var root = body && body['subsonic-response'] ? body['subsonic-response'] : null;
    if (!root) {
        throw new Error('服务器返回的内容无法识别，请检查 serverUrl 是否正确');
    }
    if (root.status !== 'ok') {
        var msg = '接口 ' + method + ' 调用失败';
        if (root.error && root.error.message) {
            msg += '：' + root.error.message;
        } else if (root.error && root.error.code) {
            msg += '（错误码 ' + root.error.code + '）';
        }
        throw new Error(msg);
    }
    return root;
}

/** Subsonic 在只有一条结果时会返回对象而不是数组，统一成数组 */
function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function coverUrl(cfg, coverArtId) {
    if (!coverArtId) return '';
    return buildUrl(cfg, 'getCoverArt', { id: coverArtId, size: COVER_SIZE });
}

function toTimestamp(isoString) {
    if (!isoString) return 0;
    var t = Date.parse(isoString);
    return isNaN(t) ? 0 : t;
}

/* ============================================================
 * 数据转换：Subsonic 模型 → MusicFree 媒体类型
 * ========================================================== */

function toMusicItem(cfg, song) {
    if (!song) return null;
    var coverId = song.coverArt || song.albumId || song.parent || '';
    return {
        id: String(song.id),
        title: song.title || song.name || '未知标题',
        artist: song.artist || song.albumArtist || '未知艺术家',
        album: song.album || '',
        duration: Number(song.duration) || 0,
        artwork: coverUrl(cfg, coverId),
        // 扩展字段：后续方法要用，会随 musicItem 一起传回来
        coverArtId: coverId ? String(coverId) : '',
        albumId: song.albumId ? String(song.albumId) : '',
        artistId: song.artistId ? String(song.artistId) : ''
    };
}

function toAlbumItem(cfg, album, kind) {
    return {
        id: String(album.id),
        title: album.name || album.title || '未知专辑',
        artist: album.artist || album.artistName || '',
        artwork: coverUrl(cfg, album.coverArt),
        worksNum: Number(album.songCount) || 0,
        createAt: toTimestamp(album.created),
        description: album.comment || '',
        // kind 用于区分「专辑」和「歌单」，getMusicSheetInfo 里要用到
        kind: kind || 'album'
    };
}

function toArtistItem(cfg, artist) {
    return {
        id: String(artist.id),
        name: artist.name || '未知艺术家',
        avatar: coverUrl(cfg, artist.coverArt),
        worksNum: Number(artist.albumCount) || 0,
        description: ''
    };
}

function toSheetItem(cfg, playlist) {
    return {
        id: String(playlist.id),
        title: playlist.name || playlist.title || '未知歌单',
        artist: playlist.owner || '',
        artwork: coverUrl(cfg, playlist.coverArt),
        worksNum: Number(playlist.songCount) || 0,
        description: playlist.comment || '',
        createAt: toTimestamp(playlist.created),
        changed: toTimestamp(playlist.changed),
        kind: 'playlist'
    };
}

/* ============================================================
 * 插件主体
 * ========================================================== */

module.exports = {
    platform: '自建曲库',
    version: '0.1.0',
    author: '冬阳',
    description: '连接你的 Navidrome / Subsonic 自建音乐服务器，搜索、播放、下载曲库里的音乐',
    srcUrl: 'https://raw.githubusercontent.com/weiyou777/musicfree-navidrome/main/navidrome.js',
    supportedSearchType: ['music', 'album', 'artist', 'sheet'],

    userVariables: [
        {
            key: 'serverUrl',
            name: '服务器地址',
            hint: '例如 https://music.example.com 或 http://192.168.1.10:4533，末尾不要带斜杠'
        },
        {
            key: 'username',
            name: '用户名',
            hint: '登录 Navidrome / Subsonic 用的用户名'
        },
        {
            key: 'password',
            name: '密码',
            hint: '登录密码，插件用 md5(密码+随机盐) 生成令牌，不会明文传输'
        }
    ],

    hints: {
        importMusicSheet: [
            '支持粘贴歌单链接或歌单 ID：',
            'https://your-server/app/#/playlist/xxxxx',
            '或直接填 ID，例如 9f8e7d6c'
        ]
    },

    /* ---------------- 搜索 ---------------- */

    async search(query, page, type) {
        if (type !== 'music' && type !== 'album' && type !== 'artist' && type !== 'sheet') {
            return { isEnd: true, data: [] };
        }
        var cfg = getConfig();
        var offset = (page - 1) * PAGE_SIZE;

        // 歌单：Subsonic 的搜索接口不检索歌单，拉一次列表在本地过滤
        if (type === 'sheet') {
            var plRoot = await subsonic(cfg, 'getPlaylists', {});
            var all = asArray(plRoot.playlists && plRoot.playlists.playlist);
            var keyword = String(query || '').toLowerCase();
            var matched = all.filter(function (p) {
                return String(p.name || '').toLowerCase().indexOf(keyword) >= 0;
            });
            var plSlice = matched.slice(offset, offset + PAGE_SIZE);
            return {
                isEnd: offset + plSlice.length >= matched.length,
                data: plSlice.map(function (p) {
                    return toSheetItem(cfg, p);
                })
            };
        }

        var extra = { query: query };
        if (type === 'music') {
            extra.songCount = PAGE_SIZE;
            extra.songOffset = offset;
        } else if (type === 'album') {
            extra.albumCount = PAGE_SIZE;
            extra.albumOffset = offset;
        } else {
            extra.artistCount = PAGE_SIZE;
            extra.artistOffset = offset;
        }

        var root = await subsonic(cfg, 'search3', extra);
        var result = root.searchResult3 || {};

        if (type === 'music') {
            var songs = asArray(result.song);
            return {
                isEnd: songs.length < PAGE_SIZE,
                data: songs
                    .map(function (s) {
                        return toMusicItem(cfg, s);
                    })
                    .filter(function (item) {
                        return item !== null;
                    })
            };
        }
        if (type === 'album') {
            var albums = asArray(result.album);
            return {
                isEnd: albums.length < PAGE_SIZE,
                data: albums.map(function (a) {
                    return toAlbumItem(cfg, a, 'album');
                })
            };
        }
        var artists = asArray(result.artist);
        return {
            isEnd: artists.length < PAGE_SIZE,
            data: artists.map(function (a) {
                return toArtistItem(cfg, a);
            })
        };
    },

    /* ---------------- 播放 / 下载链接 ---------------- */

    async getMediaSource(musicItem, quality) {
        var cfg = getConfig();
        var bitRateMap = { low: 64, standard: 128, high: 192, super: 320 };
        var extra = { id: musicItem.id };

        if (quality === 'super') {
            // 无损 / 超高品质：直接吐原文件（FLAC、APE 等原样下载，不做转码）
            extra.format = 'raw';
        } else {
            extra.maxBitRate = bitRateMap[quality] || 128;
        }

        // 这个链接既可播放也可下载；服务端没开转码时会忽略 maxBitRate，直接给原文件
        return {
            url: buildUrl(cfg, 'stream', extra),
            headers: { 'User-Agent': CLIENT_NAME }
        };
    },

    /* ---------------- 歌词 ---------------- */

    async getLyric(musicItem) {
        var cfg = getConfig();
        var root = await subsonic(cfg, 'getLyrics', {
            artist: musicItem.artist || '',
            title: musicItem.title || ''
        });
        var text = root.lyrics && root.lyrics.value ? String(root.lyrics.value).trim() : '';
        if (!text) {
            throw new Error('服务器上没有这首歌的歌词（可放同名 .lrc 文件到音乐目录）');
        }
        return { rawLrc: text };
    },

    /* ---------------- 歌曲详情 ---------------- */

    async getMusicInfo(musicItem) {
        var cfg = getConfig();
        var root = await subsonic(cfg, 'getSong', { id: musicItem.id });
        var song = root.song;
        if (!song) throw new Error('未找到该歌曲');
        var coverId = song.coverArt || song.albumId || song.parent || '';
        return {
            title: song.title || musicItem.title,
            artist: song.artist || musicItem.artist,
            album: song.album || '',
            duration: Number(song.duration) || musicItem.duration || 0,
            artwork: coverUrl(cfg, coverId),
            albumId: song.albumId ? String(song.albumId) : '',
            artistId: song.artistId ? String(song.artistId) : ''
        };
    },

    /* ---------------- 专辑详情 ---------------- */

    async getAlbumInfo(albumItem, page) {
        var cfg = getConfig();
        var root = await subsonic(cfg, 'getAlbum', { id: albumItem.id });
        var album = root.album || {};
        var songs = asArray(album.song);
        var offset = (page - 1) * PAGE_SIZE;
        var slice = songs.slice(offset, offset + PAGE_SIZE);
        var result = {
            isEnd: offset + slice.length >= songs.length,
            musicList: slice
                .map(function (s) {
                    return toMusicItem(cfg, s);
                })
                .filter(function (item) {
                    return item !== null;
                })
        };
        if (page === 1) {
            result.albumItem = {
                title: album.name || albumItem.title,
                artist: album.artist || '',
                artwork: coverUrl(cfg, album.coverArt),
                worksNum: songs.length,
                description: album.comment || ''
            };
        }
        return result;
    },

    /* ---------------- 歌单详情（也兼容「按流派」进来的专辑） ---------------- */

    async getMusicSheetInfo(sheetItem, page) {
        var cfg = getConfig();
        var offset = (page - 1) * PAGE_SIZE;

        if (sheetItem.kind === 'album') {
            return module.exports.getAlbumInfo(sheetItem, page);
        }

        var root = await subsonic(cfg, 'getPlaylist', { id: sheetItem.id });
        var playlist = root.playlist || {};
        var entries = asArray(playlist.entry);
        var slice = entries.slice(offset, offset + PAGE_SIZE);
        var result = {
            isEnd: offset + slice.length >= entries.length,
            musicList: slice
                .map(function (s) {
                    return toMusicItem(cfg, s);
                })
                .filter(function (item) {
                    return item !== null;
                })
        };
        if (page === 1) {
            result.sheetItem = {
                title: playlist.name || sheetItem.title,
                artist: playlist.owner || '',
                artwork: coverUrl(cfg, playlist.coverArt),
                worksNum: entries.length,
                description: playlist.comment || ''
            };
        }
        return result;
    },

    /* ---------------- 歌手作品 ---------------- */

    async getArtistWorks(artistItem, page, type) {
        var cfg = getConfig();
        var offset = (page - 1) * PAGE_SIZE;

        if (type === 'album') {
            var root = await subsonic(cfg, 'getArtist', { id: artistItem.id });
            var artist = root.artist || {};
            var albums = asArray(artist.album);
            var slice = albums.slice(offset, offset + PAGE_SIZE);
            return {
                isEnd: offset + slice.length >= albums.length,
                data: slice.map(function (a) {
                    return toAlbumItem(cfg, a, 'album');
                })
            };
        }

        // 歌曲：Subsonic 没有「按歌手列出全部歌曲」的接口，走搜索索引
        var sRoot = await subsonic(cfg, 'search3', {
            query: artistItem.name || '',
            songCount: PAGE_SIZE,
            songOffset: offset
        });
        var songs = asArray(sRoot.searchResult3 && sRoot.searchResult3.song).filter(function (s) {
            return String(s.artistId || '') === String(artistItem.id) || String(s.artist || '') === String(artistItem.name || '');
        });
        return {
            isEnd: songs.length < PAGE_SIZE,
            data: songs
                .map(function (s) {
                    return toMusicItem(cfg, s);
                })
                .filter(function (item) {
                    return item !== null;
                })
        };
    },

    /* ---------------- 排行榜（基于你自己的曲库） ---------------- */

    async getTopLists() {
        return [
            {
                title: '我的曲库',
                data: [
                    { id: 'random', title: '随机歌曲', worksNum: 0 },
                    { id: 'starred', title: '我收藏的', worksNum: 0 },
                    { id: 'nowPlaying', title: '正在播放', worksNum: 0 }
                ]
            }
        ];
    },

    async getTopListDetail(topListItem, page) {
        var cfg = getConfig();
        var offset = (page - 1) * PAGE_SIZE;

        if (topListItem.id === 'random') {
            // 随机每次结果不同，只给一页
            var rRoot = await subsonic(cfg, 'getRandomSongs', { size: PAGE_SIZE });
            return {
                isEnd: true,
                musicList: asArray(rRoot.randomSongs && rRoot.randomSongs.song)
                    .map(function (s) {
                        return toMusicItem(cfg, s);
                    })
                    .filter(function (item) {
                        return item !== null;
                    })
            };
        }

        if (topListItem.id === 'starred') {
            var stRoot = await subsonic(cfg, 'getStarred2', {});
            var starred = asArray(stRoot.starred2 && stRoot.starred2.song);
            var stSlice = starred.slice(offset, offset + PAGE_SIZE);
            return {
                isEnd: offset + stSlice.length >= starred.length,
                musicList: stSlice
                    .map(function (s) {
                        return toMusicItem(cfg, s);
                    })
                    .filter(function (item) {
                        return item !== null;
                    })
            };
        }

        if (topListItem.id === 'nowPlaying') {
            var npRoot = await subsonic(cfg, 'getNowPlaying', {});
            var entries = asArray(npRoot.nowPlaying && npRoot.nowPlaying.entry);
            var npSlice = entries.slice(offset, offset + PAGE_SIZE);
            return {
                isEnd: offset + npSlice.length >= entries.length,
                musicList: npSlice
                    .map(function (s) {
                        return toMusicItem(cfg, s);
                    })
                    .filter(function (item) {
                        return item !== null;
                    })
            };
        }

        return { isEnd: true, musicList: [] };
    },

    /* ---------------- 推荐歌单：按流派浏览 ---------------- */

    async getRecommendSheetTags() {
        var cfg = getConfig();
        var root = await subsonic(cfg, 'getGenres', {});
        var genres = asArray(root.genres && root.genres.genre);
        return {
            data: [
                {
                    title: '流派',
                    data: genres.map(function (g) {
                        var name = g.value || g.name || '';
                        return { id: name, title: name };
                    })
                }
            ]
        };
    },

    async getRecommendSheetsByTag(tag, page) {
        var cfg = getConfig();
        var offset = (page - 1) * PAGE_SIZE;
        var genre = tag && tag.title ? tag.title : '';
        if (!genre) return { isEnd: true, data: [] };

        try {
            var root = await subsonic(cfg, 'getAlbumList2', {
                type: 'byGenre',
                genre: genre,
                size: PAGE_SIZE,
                offset: offset
            });
            var albums = asArray(root.albumList2 && root.albumList2.album);
            return {
                isEnd: albums.length < PAGE_SIZE,
                data: albums.map(function (a) {
                    return toAlbumItem(cfg, a, 'album');
                })
            };
        } catch (e) {
            // 部分服务器不支持 byGenre，静默降级为空列表
            return { isEnd: true, data: [] };
        }
    },

    /* ---------------- 导入单曲 ---------------- */

    async importMusicItem(urlLike) {
        var cfg = getConfig();
        var id = pickId(urlLike);
        if (!id) throw new Error('无法识别的链接，请粘贴歌曲链接或歌曲 ID');
        var root = await subsonic(cfg, 'getSong', { id: id });
        var item = toMusicItem(cfg, root.song);
        if (!item) throw new Error('服务器上没有这首歌曲');
        return item;
    },

    /* ---------------- 导入歌单 ---------------- */

    async importMusicSheet(urlLike) {
        var cfg = getConfig();
        var id = pickId(urlLike);
        if (!id) throw new Error('无法识别的链接，请粘贴歌单链接或歌单 ID');
        var root = await subsonic(cfg, 'getPlaylist', { id: id });
        var entries = asArray(root.playlist && root.playlist.entry);
        return entries
            .map(function (s) {
                return toMusicItem(cfg, s);
            })
            .filter(function (item) {
                return item !== null;
            });
    }
};

/**
 * 从粘贴的文本里抠出 ID：
 * 支持 https://xxx/app/#/playlist/abc123 、...?id=abc123 、以及直接就是 abc123
 */
function pickId(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    var m = raw.match(/[?&]id=([^&#]+)/);
    if (m) return decodeURIComponent(m[1]);
    var parts = raw.split(/[\/#]/);
    var last = parts[parts.length - 1];
    if (last) return last.split('?')[0];
    return raw;
}
