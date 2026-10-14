/**
 * 极简的 Mock Subsonic 服务器，仅用于本地验证插件逻辑，不连真实服务。
 * 用法： node mock-server.js [端口]
 */

const http = require('http');
const url = require('url');

const PORT = Number(process.argv[2]) || 4533;

function song(i) {
    return {
        id: 'song-' + i,
        title: '测试歌曲 ' + i,
        album: '测试专辑 ' + (Math.floor(i / 5) + 1),
        artist: '测试歌手 ' + (Math.floor(i / 10) + 1),
        albumId: 'album-' + Math.floor(i / 5) + 1,
        artistId: 'artist-' + Math.floor(i / 10) + 1,
        coverArt: 'cover-' + i,
        duration: 200 + i,
        created: '2026-01-0' + ((i % 9) + 1) + 'T10:00:00Z'
    };
}

function album(i) {
    return {
        id: 'album-' + i,
        name: '测试专辑 ' + i,
        artist: '测试歌手 ' + i,
        artistId: 'artist-' + i,
        coverArt: 'cover-a' + i,
        songCount: 5,
        created: '2026-01-01T10:00:00Z'
    };
}

function artist(i) {
    return { id: 'artist-' + i, name: '测试歌手 ' + i, albumCount: 2, coverArt: 'cover-r' + i };
}

function playlist(i) {
    return {
        id: 'playlist-' + i,
        name: '测试歌单 ' + i,
        owner: 'admin',
        songCount: 3,
        coverArt: 'cover-p' + i,
        comment: '这是第 ' + i + ' 个测试歌单',
        created: '2026-02-01T10:00:00Z',
        changed: '2026-02-02T10:00:00Z'
    };
}

function ok(payload) {
    const body = Object.assign({ status: 'ok', version: '1.16.1', type: 'MockSubsonic' }, payload);
    return { 'subsonic-response': body };
}

function fail(code, message) {
    return { 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code: code, message: message } } };
}

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const method = String(parsed.pathname || '').replace(/^\/rest\//, '').replace(/\.view$/, '');
    const p = parsed.query;

    // 鉴权检查：必须带 u 和 (t+s) 或 p
    if (!p.u) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fail(10, '缺少用户名')));
        return;
    }
    if (!p.t && !p.p) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(fail(40, '缺少鉴权令牌')));
        return;
    }

    let data;
    switch (method) {
        case 'ping':
            data = ok({});
            break;
        case 'search3': {
            const result = {};
            if (p.songCount) result.song = [song(1), song(2), song(3)];
            if (p.albumCount) result.album = [album(1), album(2)];
            if (p.artistCount) result.artist = [artist(1), artist(2)];
            data = ok({ searchResult3: result });
            break;
        }
        case 'getSong':
            data = ok({ song: song(1) });
            break;
        case 'getAlbum':
            data = ok({ album: Object.assign(album(1), { song: [song(1), song(2), song(3)] }) });
            break;
        case 'getArtist':
            data = ok({ artist: Object.assign(artist(1), { album: [album(1), album(2)] }) });
            break;
        case 'getPlaylists':
            data = ok({ playlists: { playlist: [playlist(1), playlist(2)] } });
            break;
        case 'getPlaylist':
            data = ok({ playlist: Object.assign(playlist(1), { entry: [song(1), song(2), song(3)] }) });
            break;
        case 'getRandomSongs':
            data = ok({ randomSongs: { song: [song(4), song(5)] } });
            break;
        case 'getStarred2':
            data = ok({ starred2: { song: [song(6), song(7)], album: [album(3)] } });
            break;
        case 'getNowPlaying':
            data = ok({ nowPlaying: { entry: [song(8)] } });
            break;
        case 'getGenres':
            data = ok({ genres: { genre: [{ value: '流行', songCount: 10, albumCount: 2 }, { value: '摇滚', songCount: 5, albumCount: 1 }] } });
            break;
        case 'getAlbumList2':
            data = ok({ albumList2: { album: [album(1), album(2)] } });
            break;
        case 'getLyrics':
            data = ok({ lyrics: { value: '[00:01.00]第一句测试歌词\n[00:05.00]第二句测试歌词' } });
            break;
        case 'getCoverArt':
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(Buffer.from('89504e470d0a1a0a', 'hex'));
            return;
        case 'stream':
            res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
            res.end(Buffer.from('ID3FAKEAUDIODATA'));
            return;
        default:
            data = fail(70, 'Mock 服务器未实现的接口：' + method);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('Mock Subsonic 服务器已启动： http://127.0.0.1:' + PORT);
});
